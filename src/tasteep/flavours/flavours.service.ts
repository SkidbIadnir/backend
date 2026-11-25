import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasteepFlavour } from '../entities/tasteep-flavour.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { renamedAliases, slugify } from '../regions/regions.service';
import { CreateFlavourDto, UpdateFlavourDto } from './dto/flavour.dto';
import {
  buildFlavourIndex,
  cleanAliases,
  flavourId,
  FlavourRow,
  FlavourSeedFile,
  groupUnmatched,
  resolveTags,
  rowKeys,
  seedRows,
  toSeedFile,
  UnmatchedTagJson,
} from './flavour.rules';
import * as flavourData from '../data/flavours.json';

/** Wire shape of one entry of `GET /tasteep/flavours`. */
export interface FlavourJson {
  id: string;
  name_en: string;
  name_fr: string;
  /**
   * Other spellings this entry matches (`peaty`, `tourbé`), so the app can
   * tell which of a tasting's tags a picked chip stands for.
   */
  aliases: string[];
}
export interface FlavourCategoryJson extends FlavourJson {
  children: FlavourJson[];
}

/** Admin view of a row. */
export interface AdminFlavourRowJson {
  id: string;
  parent_id: string | null;
  name_en: string;
  name_fr: string;
  sort_order: number;
  aliases: string[];
  deleted_at: string | null;
}
/** Counts are of tastings whose `flavour_ids` hold this id, not its children's. */
export interface AdminFlavourNodeJson extends AdminFlavourRowJson {
  tasting_count: number;
}
export interface AdminFlavourTreeJson extends AdminFlavourNodeJson {
  children: AdminFlavourNodeJson[];
}

export interface ReindexResultJson {
  /** Tastings with tags or flavour ids that were looked at. */
  scanned: number;
  /** Tastings whose `flavour_ids` changed. */
  updated: number;
}

export interface UnmatchedTagsJson {
  /** Distinct unmatched keys in all, before `limit`. */
  total: number;
  tags: UnmatchedTagJson[];
}

const REINDEX_BATCH = 1000;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const toAdminFlavourRowJson = (
  r: TasteepFlavour,
): AdminFlavourRowJson => ({
  id: r.id,
  parent_id: r.parentId,
  name_en: r.nameEn,
  name_fr: r.nameFr,
  sort_order: r.sortOrder,
  aliases: r.aliases ?? [],
  deleted_at: r.deletedAt ? r.deletedAt.toISOString() : null,
});

/** Categories in display order, each with its flavours. */
function nest(
  rows: TasteepFlavour[],
): { category: TasteepFlavour; children: TasteepFlavour[] }[] {
  const sorted = [...rows].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.nameEn.localeCompare(b.nameEn),
  );
  return sorted
    .filter((r) => r.parentId === null)
    .map((category) => ({
      category,
      children: sorted.filter((r) => r.parentId === category.id),
    }));
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The flavour vocabulary. Seeds `tasteep_flavours` from `flavours.json` at
 * boot, matches tasting tags to flavour ids, keeps
 * `tasteep_tastings.flavour_ids` in step with the vocabulary (`reindex`), and
 * backs `/admin/flavours`.
 *
 * `tags` is what the user typed and is never rewritten; `flavour_ids` is
 * derived from it, the way `region_id` sits next to the free-text `region`.
 */
@Injectable()
export class FlavoursService implements OnModuleInit {
  private readonly logger = new Logger(FlavoursService.name);

  constructor(
    @InjectRepository(TasteepFlavour)
    private readonly repo: Repository<TasteepFlavour>,
    @InjectRepository(TasteepTasting)
    private readonly tastingRepo: Repository<TasteepTasting>,
  ) {}

  /**
   * Seeds, then reindexes when the seed changed anything: on the first boot
   * that backfills `flavour_ids` of every existing tasting, and later it
   * picks up aliases shipped in a new `flavours.json`.
   */
  async onModuleInit(): Promise<void> {
    if ((await this.seed()) > 0) await this.reindex();
  }

  /**
   * Inserts the file's ids that the table doesn't have (deleted rows count as
   * present, and a flavour whose category was deleted stays out), and adds the
   * file's aliases missing from live rows. Never renames or removes anything.
   * Returns the number of rows inserted or given new aliases.
   */
  async seed(file: FlavourSeedFile = flavourData): Promise<number> {
    const existing = new Map(
      (await this.repo.find({ withDeleted: true })).map((r) => [r.id, r]),
    );
    const rows = seedRows(file);
    const missing = rows.filter((r) => !existing.has(r.id));
    const parents = missing.filter((r) => r.parentId === null);
    const children = missing.filter(
      (r) => r.parentId !== null && !existing.get(r.parentId)?.deletedAt,
    );
    // Categories first for the self-referencing FK; orIgnore in case another
    // instance booting at the same time inserts first.
    for (const batch of [parents, children]) {
      if (!batch.length) continue;
      await this.repo
        .createQueryBuilder()
        .insert()
        .values(batch)
        .orIgnore()
        .execute();
    }

    let aliased = 0;
    for (const r of rows) {
      const row = existing.get(r.id);
      if (!row || row.deletedAt) continue;
      const merged = cleanAliases([...row.aliases, ...r.aliases], row);
      if (sameList(merged, row.aliases)) continue;
      await this.repo.update({ id: r.id }, { aliases: merged });
      aliased++;
    }

    this.logger.log(
      `Seeded ${parents.length} new categor(y/ies) and ${children.length} new flavour(s); ${existing.size} already present${aliased ? `, aliases added to ${aliased}` : ''}.`,
    );
    return parents.length + children.length + aliased;
  }

  /** Live categories in display order, each with its live flavours. */
  async tree(): Promise<FlavourCategoryJson[]> {
    const toJson = (r: TasteepFlavour): FlavourJson => ({
      id: r.id,
      name_en: r.nameEn,
      name_fr: r.nameFr,
      aliases: r.aliases ?? [],
    });
    return nest(await this.repo.find()).map(({ category, children }) => ({
      ...toJson(category),
      children: children.map(toJson),
    }));
  }

  /** The flavour ids `tags` match among live rows, in tag order. */
  async resolve(tags: readonly string[]): Promise<string[]> {
    if (!tags.length) return [];
    return resolveTags(tags, await this.index());
  }

  /**
   * Recomputes `flavour_ids` of every tasting that has tags or flavour ids,
   * in id-ordered batches. A row is only written if its `tags` are still the
   * ones read, so a tasting saved meanwhile keeps the ids its own write
   * computed. `updated_at` is left alone: the user didn't change anything.
   */
  async reindex(): Promise<ReindexResultJson> {
    const index = await this.index();
    let after = NIL_UUID;
    let scanned = 0;
    let updated = 0;
    for (;;) {
      const batch: { id: string; tags: string[]; flavour_ids: string[] }[] =
        await this.tastingRepo.query(
          `SELECT id, tags, flavour_ids FROM tasteep_tastings
            WHERE id > $1 AND (cardinality(tags) > 0 OR cardinality(flavour_ids) > 0)
            ORDER BY id LIMIT $2`,
          [after, REINDEX_BATCH],
        );
      if (!batch.length) break;
      scanned += batch.length;
      after = batch[batch.length - 1].id;

      const changes = batch
        .map((t) => ({ t, ids: resolveTags(t.tags, index) }))
        .filter(({ t, ids }) => !sameList(ids, t.flavour_ids))
        .map(({ t, ids }) => ({ id: t.id, tags: t.tags, ids }));
      if (changes.length) {
        const [, count] = await this.tastingRepo.query<[unknown, number]>(
          `UPDATE tasteep_tastings t
              SET flavour_ids = ARRAY(
                    SELECT e FROM jsonb_array_elements_text(v.ids) WITH ORDINALITY AS x(e, n)
                     ORDER BY n)
             FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, tags jsonb, ids jsonb)
            WHERE t.id = v.id AND to_jsonb(t.tags) = v.tags`,
          [JSON.stringify(changes)],
        );
        updated += count;
      }
      if (batch.length < REINDEX_BATCH) break;
    }
    this.logger.log(
      `Reindexed flavours: ${scanned} tasting(s) scanned, ${updated} updated.`,
    );
    return { scanned, updated };
  }

  /** `tree()` plus admin fields and usage counts; `include_deleted` adds soft-deleted rows. */
  async adminTree(
    query: { include_deleted?: boolean } = {},
  ): Promise<AdminFlavourTreeJson[]> {
    const rows = await this.repo.find({
      withDeleted: query.include_deleted ?? false,
    });
    const raw: { id: string; count: number }[] = await this.tastingRepo.query(
      `SELECT fid AS id, COUNT(*)::int AS count
         FROM tasteep_tastings, unnest(flavour_ids) AS fid GROUP BY fid`,
    );
    const counts = new Map(raw.map((r) => [r.id, r.count]));
    const toNode = (r: TasteepFlavour): AdminFlavourNodeJson => ({
      ...toAdminFlavourRowJson(r),
      tasting_count: counts.get(r.id) ?? 0,
    });
    return nest(rows).map(({ category, children }) => ({
      ...toNode(category),
      children: children.map(toNode),
    }));
  }

  /**
   * Tags no live flavour matches, grouped by normalised key across users,
   * most widely used first: the queue to map as aliases or turn into
   * flavours.
   */
  async unmatched(limit = 100): Promise<UnmatchedTagsJson> {
    const raw: { tag: string; user_id: string; count: number }[] =
      await this.tastingRepo.query(
        `SELECT tag, user_id, COUNT(*)::int AS count
           FROM tasteep_tastings, unnest(tags) AS tag GROUP BY tag, user_id`,
      );
    const all = groupUnmatched(raw, await this.index());
    return { total: all.length, tags: all.slice(0, limit) };
  }

  /** `409` if the id is live or a key is taken; a soft-deleted id is brought back with the new values. */
  async create(dto: CreateFlavourDto): Promise<AdminFlavourRowJson> {
    if (!slugify(dto.name_en)) {
      throw new BadRequestException('name_en must contain a letter or digit.');
    }
    const parentId = dto.parent_id ?? null;
    if (parentId !== null) {
      const parent = await this.repo.findOne({ where: { id: parentId } });
      if (!parent) {
        throw new BadRequestException(`Unknown parent_id "${parentId}".`);
      }
      if (parent.parentId !== null) {
        throw new BadRequestException(
          `"${parentId}" is a flavour; only categories have children.`,
        );
      }
    }
    const id = flavourId(dto.name_en, parentId);

    const existing = await this.repo.findOne({
      where: { id },
      withDeleted: true,
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Flavour "${id}" already exists.`);
    }
    const row: FlavourRow = {
      id,
      nameEn: dto.name_en.trim(),
      nameFr: dto.name_fr.trim(),
      parentId,
      sortOrder: existing
        ? existing.sortOrder
        : await this.nextSortOrder(parentId),
      aliases: [],
    };
    row.aliases = cleanAliases(dto.aliases ?? existing?.aliases ?? [], row);
    await this.assertKeysFree(row);

    await this.repo.save(this.repo.create({ ...row, deletedAt: null }));
    await this.reindex();
    return toAdminFlavourRowJson(await this.findLive(id));
  }

  async update(
    id: string,
    dto: UpdateFlavourDto,
  ): Promise<AdminFlavourRowJson> {
    const row = await this.findLive(id);
    let aliases = dto.aliases ?? row.aliases;
    if (dto.name_en !== undefined) {
      aliases = renamedAliases(aliases, row.nameEn, dto.name_en.trim());
      row.nameEn = dto.name_en.trim();
    }
    if (dto.name_fr !== undefined) {
      aliases = renamedAliases(aliases, row.nameFr, dto.name_fr.trim());
      row.nameFr = dto.name_fr.trim();
    }
    if (dto.sort_order !== undefined) row.sortOrder = dto.sort_order;
    row.aliases = cleanAliases(aliases, row);
    await this.assertKeysFree(row);

    await this.repo.save(row);
    await this.reindex();
    return toAdminFlavourRowJson(await this.findLive(id));
  }

  /** Adds one spelling to a live row; a no-op if the row already answers to it. */
  async addAlias(id: string, alias: string): Promise<AdminFlavourRowJson> {
    const row = await this.findLive(id);
    const aliases = cleanAliases([...row.aliases, alias], row);
    if (!sameList(aliases, row.aliases)) {
      await this.assertKeysFree({ ...row, aliases });
      row.aliases = aliases;
      await this.repo.save(row);
      await this.reindex();
    }
    return toAdminFlavourRowJson(await this.findLive(id));
  }

  /** Soft delete; a category takes its live flavours with it. Their ids leave `flavour_ids`. */
  async remove(id: string): Promise<void> {
    await this.findLive(id);
    // One statement, so the category and its flavours share a `deleted_at`
    // and `restore` can tell them apart from flavours deleted earlier.
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ deletedAt: () => 'CURRENT_TIMESTAMP' })
      .where('(id = :id OR parent_id = :id) AND deleted_at IS NULL', { id })
      .execute();
    await this.reindex();
  }

  /**
   * Brings back a row and the flavours deleted together with it. `409` under
   * a deleted category, or when a live row has taken one of its keys since.
   */
  async restore(id: string): Promise<AdminFlavourRowJson> {
    const row = await this.repo.findOne({ where: { id }, withDeleted: true });
    if (!row) throw new NotFoundException(`Unknown flavour ${id}.`);
    if (row.deletedAt) {
      if (row.parentId !== null) {
        const parent = await this.repo.findOne({
          where: { id: row.parentId },
          withDeleted: true,
        });
        if (parent?.deletedAt) {
          throw new ConflictException(
            `Restore "${row.parentId}" first; it is deleted too.`,
          );
        }
      }
      // In SQL: a JS Date would drop the microseconds of `deleted_at`.
      const together = await this.repo
        .createQueryBuilder('f')
        .withDeleted()
        .where(
          'f.parentId = :id AND f.deletedAt = (SELECT deleted_at FROM tasteep_flavours WHERE id = :id)',
          { id },
        )
        .getMany();
      for (const r of [row, ...together]) await this.assertKeysFree(r);

      await this.repo.query(
        `UPDATE tasteep_flavours SET deleted_at = NULL
          WHERE id = $1
             OR (parent_id = $1 AND deleted_at = (SELECT deleted_at FROM tasteep_flavours WHERE id = $1))`,
        [id],
      );
      await this.reindex();
    }
    return toAdminFlavourRowJson(await this.findLive(id));
  }

  /** Live rows in the seed file's format, to replace `flavours.json` with. */
  async exportSeedFile(
    bundled: FlavourSeedFile = flavourData,
  ): Promise<FlavourSeedFile> {
    return toSeedFile(await this.repo.find(), bundled);
  }

  private async index(): Promise<Map<string, string>> {
    return buildFlavourIndex(await this.repo.find());
  }

  /** `409` when another live row already answers to one of `row`'s keys. */
  private async assertKeysFree(row: FlavourRow): Promise<void> {
    const owners = new Map<string, string>();
    for (const other of await this.repo.find()) {
      if (other.id === row.id) continue;
      for (const key of rowKeys(other)) owners.set(key, other.id);
    }
    for (const key of rowKeys(row)) {
      const owner = owners.get(key);
      if (owner) {
        throw new ConflictException(
          `"${key}" already matches flavour "${owner}".`,
        );
      }
    }
  }

  private async findLive(id: string): Promise<TasteepFlavour> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Unknown flavour ${id}.`);
    return row;
  }

  private async nextSortOrder(parentId: string | null): Promise<number> {
    const qb = this.repo
      .createQueryBuilder('f')
      .withDeleted()
      .select('MAX(f.sortOrder)', 'max');
    if (parentId === null) qb.where('f.parentId IS NULL');
    else qb.where('f.parentId = :parentId', { parentId });
    const raw = await qb.getRawOne<{ max: number | null }>();
    return (raw?.max ?? -1) + 1;
  }
}
