import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TasteepRegion } from '../entities/tasteep-region.entity';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import {
  CreateRegionDto,
  ReorderRegionsDto,
  UpdateRegionDto,
} from './dto/region.dto';
import * as regionData from '../data/region.json';

/** Shape of `src/tasteep/data/region.json`. */
export interface RegionSeedFile {
  _comment?: string;
  regions: {
    /** Only when it isn't `slugify(main)`, i.e. the row was renamed after creation. */
    id?: string;
    main: string;
    lat: number | null;
    lon: number | null;
    aliases?: string[];
    sub: {
      /** Full id (`scotland/islay`), only when it isn't the one derived from the names. */
      id?: string;
      name: string;
      lat: number | null;
      lon: number | null;
      aliases?: string[];
    }[];
  }[];
}

/** Wire shape of one entry of `GET /tasteep/regions`. */
export interface SubregionJson {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
}
export interface RegionJson extends SubregionJson {
  subregions: SubregionJson[];
}

/** Admin view of a row. */
export interface AdminRegionRowJson {
  id: string;
  name: string;
  parent_id: string | null;
  lat: number | null;
  lon: number | null;
  sort_order: number;
  aliases: string[];
  deleted_at: string | null;
}

/** A node of `GET /admin/regions`; counts are of rows linking to this node only, not its subregions. */
export interface AdminRegionNodeJson extends AdminRegionRowJson {
  tasting_count: number;
  smws_code_count: number;
}
export interface AdminRegionTreeJson extends AdminRegionNodeJson {
  subregions: AdminRegionNodeJson[];
}

type SeedRow = Pick<
  TasteepRegion,
  'id' | 'name' | 'parentId' | 'lat' | 'lon' | 'sortOrder'
> & { aliases: string[] };

type FieldValue = string | number | string[] | null;

/** `"Cork County"` → `"cork-county"`; strips diacritics, keeps `[a-z0-9]`. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Case/whitespace-insensitive key used to match typed text against names. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Builds the rows the seed file describes, parents before children. */
export function seedRows(file: RegionSeedFile): SeedRow[] {
  const rows: SeedRow[] = [];
  file.regions.forEach((country, i) => {
    const countryId = country.id ?? slugify(country.main);
    rows.push({
      id: countryId,
      name: country.main,
      parentId: null,
      lat: country.lat,
      lon: country.lon,
      sortOrder: i,
      aliases: country.aliases ?? [],
    });
    country.sub.forEach((sub, j) => {
      rows.push({
        id: sub.id ?? `${countryId}/${slugify(sub.name)}`,
        name: sub.name,
        parentId: countryId,
        lat: sub.lat,
        lon: sub.lon,
        sortOrder: j,
        aliases: sub.aliases ?? [],
      });
    });
  });
  return rows;
}

export const toAdminRegionRowJson = (r: TasteepRegion): AdminRegionRowJson => ({
  id: r.id,
  name: r.name,
  parent_id: r.parentId,
  lat: r.lat ?? null,
  lon: r.lon ?? null,
  sort_order: r.sortOrder,
  aliases: r.aliases ?? [],
  deleted_at: r.deletedAt ? r.deletedAt.toISOString() : null,
});

function byDisplayOrder(a: TasteepRegion, b: TasteepRegion): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/** Groups rows into countries, each with its subregions, in display order. */
function nest(
  rows: TasteepRegion[],
): { country: TasteepRegion; subregions: TasteepRegion[] }[] {
  const sorted = [...rows].sort(byDisplayOrder);
  const byParent = new Map<string, TasteepRegion[]>();
  for (const r of sorted) {
    if (r.parentId === null) continue;
    const list = byParent.get(r.parentId) ?? [];
    list.push(r);
    byParent.set(r.parentId, list);
  }
  return sorted
    .filter((r) => r.parentId === null)
    .map((country) => ({
      country,
      subregions: byParent.get(country.id) ?? [],
    }));
}

/** Turns live rows back into the seed file's format, keeping the bundled file's comment. */
export function toSeedFile(
  rows: TasteepRegion[],
  bundled: RegionSeedFile,
): RegionSeedFile {
  const aliases = (r: TasteepRegion) =>
    r.aliases?.length ? { aliases: r.aliases } : {};
  return {
    ...(bundled._comment ? { _comment: bundled._comment } : {}),
    regions: nest(rows).map(({ country, subregions }) => ({
      ...(slugify(country.name) !== country.id ? { id: country.id } : {}),
      main: country.name,
      lat: country.lat,
      lon: country.lon,
      ...aliases(country),
      sub: subregions.map((s) => ({
        ...(`${country.id}/${slugify(s.name)}` !== s.id ? { id: s.id } : {}),
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        ...aliases(s),
      })),
    })),
  };
}

/**
 * The curated region picker. Seeds `tasteep_regions` from `region.json` at
 * boot (missing ids only, so dashboard edits and deletes survive restarts),
 * resolves what a tasting typed or picked to a row, and backs
 * `/admin/regions`.
 */
@Injectable()
export class RegionsService implements OnModuleInit {
  private readonly logger = new Logger(RegionsService.name);

  constructor(
    @InjectRepository(TasteepRegion)
    private readonly repo: Repository<TasteepRegion>,
    @InjectRepository(TasteepTasting)
    private readonly tastingRepo: Repository<TasteepTasting>,
    @InjectRepository(TasteepSmwsCode)
    private readonly codeRepo: Repository<TasteepSmwsCode>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /**
   * Inserts the file's ids that the table doesn't have, deleted rows
   * included; a subregion whose country was deleted stays out too. Rows whose
   * `aliases` were never set (`NULL`, e.g. created before the column existed)
   * get the file's.
   */
  async seed(
    file: RegionSeedFile = regionData as RegionSeedFile,
  ): Promise<number> {
    const existing = new Map(
      (await this.repo.find({ withDeleted: true })).map((r) => [r.id, r]),
    );
    const rows = seedRows(file);
    const missing = rows.filter((r) => !existing.has(r.id));
    const parents = missing.filter((r) => r.parentId === null);
    const children = missing.filter(
      (r) => r.parentId !== null && !existing.get(r.parentId)?.deletedAt,
    );
    // Parents first so the self-referencing FK is satisfied; orIgnore because
    // another instance booting at the same time may insert first.
    for (const batch of [parents, children]) {
      if (!batch.length) continue;
      await this.repo
        .createQueryBuilder()
        .insert()
        .values(batch)
        .orIgnore()
        .execute();
    }

    let backfilled = 0;
    for (const r of rows) {
      const row = existing.get(r.id);
      if (!row || row.aliases !== null) continue;
      await this.repo.update(
        { id: r.id, aliases: IsNull() },
        { aliases: r.aliases },
      );
      backfilled++;
    }

    this.logger.log(
      `Seeded ${parents.length} new region(s) and ${children.length} new subregion(s); ${existing.size} already present${backfilled ? `, aliases set on ${backfilled}` : ''}.`,
    );
    return parents.length + children.length;
  }

  /** Live countries in display order, each with its live subregions. */
  async tree(): Promise<RegionJson[]> {
    const toJson = (r: TasteepRegion): SubregionJson => ({
      id: r.id,
      name: r.name,
      lat: r.lat ?? null,
      lon: r.lon ?? null,
    });
    return nest(await this.repo.find()).map(({ country, subregions }) => ({
      ...toJson(country),
      subregions: subregions.map(toJson),
    }));
  }

  /** `tree()` plus admin fields and usage counts; `include_deleted` adds soft-deleted rows. */
  async adminTree(
    query: { include_deleted?: boolean } = {},
  ): Promise<AdminRegionTreeJson[]> {
    const rows = await this.repo.find({
      withDeleted: query.include_deleted ?? false,
    });
    const [tastings, codes] = await Promise.all([
      this.countByRegion(this.tastingRepo, 't'),
      this.countByRegion(this.codeRepo, 'c'),
    ]);
    const toNode = (r: TasteepRegion): AdminRegionNodeJson => ({
      ...toAdminRegionRowJson(r),
      tasting_count: tastings.get(r.id) ?? 0,
      smws_code_count: codes.get(r.id) ?? 0,
    });
    return nest(rows).map(({ country, subregions }) => ({
      ...toNode(country),
      subregions: subregions.map(toNode),
    }));
  }

  /**
   * What a tasting should link to.
   *  - `regionId` given → that row, even soft-deleted (links survive a
   *    delete, and a client may still hold the id); `400` if it never existed.
   *  - otherwise `regionText` is matched case-insensitively against live
   *    names and aliases, whole first, then each `,`/`/`-separated part (so
   *    both "Islay" and "Islay, Scotland" link to `scotland/islay`). A
   *    subregion beats its country when both appear.
   *  - nothing matched → `null`; the free text is kept on the tasting as is.
   */
  async resolve(
    regionId: string | null | undefined,
    regionText: string | null | undefined,
  ): Promise<TasteepRegion | null> {
    if (regionId) {
      const row = await this.repo.findOne({
        where: { id: regionId },
        withDeleted: true,
      });
      if (!row) {
        throw new BadRequestException(`Unknown region_id "${regionId}".`);
      }
      return row;
    }

    const text = normalizeName(regionText ?? '');
    if (!text) return null;

    const rows = await this.repo.find();
    const aliases = new Map<string, TasteepRegion>();
    for (const r of rows) {
      for (const a of r.aliases ?? []) {
        if (!aliases.has(normalizeName(a))) aliases.set(normalizeName(a), r);
      }
    }
    const candidates = [
      text,
      ...text
        .split(/[,/|()]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ];

    const matches: TasteepRegion[] = [];
    for (const candidate of candidates) {
      const aliased = aliases.get(candidate);
      if (aliased) matches.push(aliased);
      matches.push(...rows.filter((r) => normalizeName(r.name) === candidate));
    }
    if (!matches.length) return null;

    // Stable sort: subregions first, otherwise keep first-seen order.
    return matches.sort(
      (a, b) => Number(a.parentId === null) - Number(b.parentId === null),
    )[0];
  }

  /** `409` if the id is live; a soft-deleted id is brought back with the new values. */
  async create(dto: CreateRegionDto): Promise<AdminRegionRowJson> {
    const slug = slugify(dto.name);
    if (!slug) {
      throw new BadRequestException('name must contain a letter or digit.');
    }
    const parentId = dto.parent_id ?? null;
    if (parentId !== null) {
      const parent = await this.repo.findOne({ where: { id: parentId } });
      if (!parent) {
        throw new BadRequestException(`Unknown parent_id "${parentId}".`);
      }
      if (parent.parentId !== null) {
        throw new BadRequestException(
          `"${parentId}" is a subregion; subregions can't have subregions.`,
        );
      }
    }
    const id = parentId ? `${parentId}/${slug}` : slug;

    const existing = await this.repo.findOne({
      where: { id },
      withDeleted: true,
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Region "${id}" already exists.`);
    }
    await this.repo.save(
      this.repo.create({
        id,
        name: dto.name,
        parentId,
        lat: dto.lat ?? null,
        lon: dto.lon ?? null,
        sortOrder: existing
          ? existing.sortOrder
          : await this.nextSortOrder(parentId),
        aliases: dto.aliases ?? existing?.aliases ?? [],
        deletedAt: null,
      }),
    );
    return toAdminRegionRowJson(await this.findLive(id));
  }

  async update(id: string, dto: UpdateRegionDto): Promise<AdminRegionRowJson> {
    const row = await this.findLive(id);
    if (dto.aliases !== undefined) row.aliases = dto.aliases;
    if (dto.lat !== undefined) row.lat = dto.lat;
    if (dto.lon !== undefined) row.lon = dto.lon;
    if (dto.sort_order !== undefined) row.sortOrder = dto.sort_order;
    if (dto.name !== undefined) {
      const oldName = row.name;
      row.name = dto.name;
      row.aliases = renamedAliases(row.aliases ?? [], oldName, dto.name);
    }
    await this.repo.save(row);
    return toAdminRegionRowJson(await this.findLive(id));
  }

  /**
   * Soft delete; a country takes its live subregions with it. Tastings and
   * SMWS codes keep their `region_id`.
   */
  async remove(id: string): Promise<void> {
    await this.findLive(id);
    // One statement, so the country and its subregions share a `deleted_at`
    // and `restore` can tell them apart from subregions deleted earlier.
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ deletedAt: () => 'CURRENT_TIMESTAMP' })
      .where('(id = :id OR parent_id = :id) AND deleted_at IS NULL', { id })
      .execute();
  }

  /** Brings back a row and the subregions deleted together with it. `409` under a deleted country. */
  async restore(id: string): Promise<AdminRegionRowJson> {
    const row = await this.repo.findOne({ where: { id }, withDeleted: true });
    if (!row) throw new NotFoundException(`Unknown region ${id}.`);
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
      await this.repo.query(
        `UPDATE tasteep_regions SET deleted_at = NULL
          WHERE id = $1
             OR (parent_id = $1 AND deleted_at = (SELECT deleted_at FROM tasteep_regions WHERE id = $1))`,
        [id],
      );
    }
    return toAdminRegionRowJson(await this.findLive(id));
  }

  /** Sets `sort_order` from the position in `ids`, which must list every live sibling exactly once. */
  async reorder(dto: ReorderRegionsDto): Promise<AdminRegionTreeJson[]> {
    const parentId = dto.parent_id ?? null;
    if (parentId !== null) await this.findLive(parentId);
    const siblings = await this.repo.find({
      where: { parentId: parentId ?? IsNull() },
    });
    const expected = new Set(siblings.map((r) => r.id));
    const given = new Set(dto.ids);
    if (
      given.size !== dto.ids.length ||
      given.size !== expected.size ||
      dto.ids.some((id) => !expected.has(id))
    ) {
      throw new BadRequestException(
        `ids must list each live ${parentId ? `subregion of "${parentId}"` : 'country'} exactly once.`,
      );
    }
    await this.repo.manager.transaction(async (em) => {
      for (const [i, id] of dto.ids.entries()) {
        await em.update(TasteepRegion, { id }, { sortOrder: i });
      }
    });
    return this.adminTree();
  }

  /**
   * Table vs seed file. `only_in_json` ids will be inserted on the next
   * boot; `deleted_in_table` ones won't (they were deleted on purpose).
   * Order is not compared: positions shift whenever a row is added or
   * deleted, so they would always differ.
   */
  async diff(file: RegionSeedFile = regionData as RegionSeedFile) {
    const json = seedRows(file);
    const rows = await this.repo.find({ withDeleted: true });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const jsonIds = new Set(json.map((r) => r.id));

    const onlyInJson: string[] = [];
    const deletedInTable: string[] = [];
    const changed: {
      id: string;
      fields: { field: string; json: FieldValue; table: FieldValue }[];
    }[] = [];
    for (const j of json) {
      const row = byId.get(j.id);
      if (!row) {
        onlyInJson.push(j.id);
        continue;
      }
      if (row.deletedAt) {
        deletedInTable.push(j.id);
        continue;
      }
      const pairs: [string, FieldValue, FieldValue][] = [
        ['name', j.name, row.name],
        ['lat', j.lat, row.lat],
        ['lon', j.lon, row.lon],
        ['aliases', j.aliases, row.aliases ?? []],
      ];
      const fields = pairs
        .filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b))
        .map(([field, a, b]) => ({ field, json: a, table: b }));
      if (fields.length) changed.push({ id: j.id, fields });
    }
    const onlyInTable = rows
      .filter((r) => !r.deletedAt && !jsonIds.has(r.id))
      .map((r) => r.id)
      .sort();

    return {
      in_sync:
        !onlyInJson.length &&
        !deletedInTable.length &&
        !onlyInTable.length &&
        !changed.length,
      only_in_json: onlyInJson,
      only_in_table: onlyInTable,
      deleted_in_table: deletedInTable,
      changed,
    };
  }

  /** Live rows in the seed file's format, to replace `region.json` with. */
  async exportSeedFile(
    bundled: RegionSeedFile = regionData as RegionSeedFile,
  ): Promise<RegionSeedFile> {
    return toSeedFile(await this.repo.find(), bundled);
  }

  private async findLive(id: string): Promise<TasteepRegion> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Unknown region ${id}.`);
    return row;
  }

  private async nextSortOrder(parentId: string | null): Promise<number> {
    const qb = this.repo
      .createQueryBuilder('r')
      .withDeleted()
      .select('MAX(r.sortOrder)', 'max');
    if (parentId === null) qb.where('r.parentId IS NULL');
    else qb.where('r.parentId = :parentId', { parentId });
    const raw = await qb.getRawOne<{ max: number | null }>();
    return (raw?.max ?? -1) + 1;
  }

  /** `region_id` → number of rows pointing at it (soft-deleted SMWS codes excluded). */
  private async countByRegion(
    repo: Repository<TasteepTasting> | Repository<TasteepSmwsCode>,
    alias: string,
  ): Promise<Map<string, number>> {
    const raw = await (repo as Repository<TasteepTasting>)
      .createQueryBuilder(alias)
      .select(`${alias}.regionId`, 'region_id')
      .addSelect('COUNT(*)::int', 'count')
      .where(`${alias}.regionId IS NOT NULL`)
      .groupBy(`${alias}.regionId`)
      .getRawMany<{ region_id: string; count: number }>();
    return new Map(raw.map((r) => [r.region_id, r.count]));
  }
}

/** On a rename, keeps the old name as an alias and drops any alias equal to the new name. */
export function renamedAliases(
  aliases: string[],
  oldName: string,
  newName: string,
): string[] {
  const next = normalizeName(newName);
  const kept = aliases.filter((a) => normalizeName(a) !== next);
  const old = normalizeName(oldName);
  if (old !== next && !kept.some((a) => normalizeName(a) === old)) {
    kept.push(oldName);
  }
  return kept;
}
