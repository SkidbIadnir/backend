import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import { RegionsService } from '../regions/regions.service';
import { CreateSmwsCodeDto, UpdateSmwsCodeDto } from './dto/smws-code.dto';
import * as smwsCodeData from '../data/smws-codes.json';

/** Shape of `src/tasteep/data/smws-codes.json`: category → its codes. */
export type SmwsCodeSeedFile = Record<
  string,
  {
    distilleries: {
      distilleryName: string;
      /** A number for single malts (`1`), a string elsewhere (`G1`). */
      smwsId: number | string;
      region: string | null;
      extra: string | null;
    }[];
  }
>;

/** One entry of `GET /tasteep/smws-codes`. Content only, so the app can re-hash what it stored. */
export interface SmwsCodeJson {
  code: string;
  distillery_name: string;
  category: string;
  region: string | null;
  region_id: string | null;
  extra: string | null;
}

export interface SmwsCodeSnapshot {
  /** See `snapshotVersion`. */
  version: string;
  items: SmwsCodeJson[];
}

/** Admin view of a row: the app's fields plus bookkeeping. */
export interface AdminSmwsCodeJson extends SmwsCodeJson {
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Fields the seed file and the table both carry, compared by `diff`. */
const COMPARED_FIELDS = [
  ['distilleryName', 'distillery_name'],
  ['category', 'category'],
  ['region', 'region'],
  ['extra', 'extra'],
] as const;

type SeedRow = Pick<
  TasteepSmwsCode,
  'code' | 'distilleryName' | 'category' | 'region' | 'extra' | 'sortOrder'
>;

/** Flattens the seed file into rows, numbering them in file order. */
export function seedRows(file: SmwsCodeSeedFile): SeedRow[] {
  const rows: SeedRow[] = [];
  for (const [category, { distilleries }] of Object.entries(file)) {
    for (const d of distilleries ?? []) {
      rows.push({
        code: String(d.smwsId),
        distilleryName: d.distilleryName,
        category,
        region: d.region ?? null,
        extra: d.extra ?? null,
        sortOrder: rows.length,
      });
    }
  }
  return rows;
}

export const toSmwsCodeJson = (r: TasteepSmwsCode): SmwsCodeJson => ({
  code: r.code,
  distillery_name: r.distilleryName,
  category: r.category,
  region: r.region,
  region_id: r.regionId,
  extra: r.extra,
});

export const toAdminSmwsCodeJson = (r: TasteepSmwsCode): AdminSmwsCodeJson => ({
  ...toSmwsCodeJson(r),
  sort_order: r.sortOrder,
  created_at: r.createdAt.toISOString(),
  updated_at: r.updatedAt.toISOString(),
  deleted_at: r.deletedAt ? r.deletedAt.toISOString() : null,
});

/**
 * Hex SHA-256 of `JSON.stringify(items)`, items in snapshot order with keys
 * in `SmwsCodeJson` order. The app recomputes it over its stored copy to check
 * the copy is intact and matches what the server last sent.
 */
export function snapshotVersion(items: SmwsCodeJson[]): string {
  return createHash('sha256').update(JSON.stringify(items)).digest('hex');
}

/** Turns live rows back into the seed file's format (all-digit codes become numbers again). */
export function toSeedFile(rows: TasteepSmwsCode[]): SmwsCodeSeedFile {
  const sorted = [...rows].sort(bySnapshotOrder);
  const file: SmwsCodeSeedFile = {};
  // Categories appear in the order of their first code, as in the original file.
  for (const r of sorted) {
    (file[r.category] ??= { distilleries: [] }).distilleries.push({
      distilleryName: r.distilleryName,
      smwsId: /^[0-9]+$/.test(r.code) ? Number(r.code) : r.code,
      region: r.region,
      extra: r.extra,
    });
  }
  return file;
}

function bySnapshotOrder(a: TasteepSmwsCode, b: TasteepSmwsCode): number {
  return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);
}

/**
 * SMWS code → distillery reference list (`tasteep_smws_codes`): the app
 * downloads it whole for offline use, the admin dashboard edits it.
 */
@Injectable()
export class SmwsCodesService implements OnModuleInit {
  private readonly logger = new Logger(SmwsCodesService.name);

  constructor(
    @InjectRepository(TasteepSmwsCode)
    private readonly repo: Repository<TasteepSmwsCode>,
    private readonly regions: RegionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /**
   * Inserts the file's codes that the table doesn't have, deleted rows
   * included, so dashboard edits and deletes are never overwritten. Runs
   * after `RegionsService.seed` (this module imports `RegionsModule`, and
   * Nest initialises imported modules first), so `region_id` can resolve.
   */
  async seed(
    file: SmwsCodeSeedFile = smwsCodeData as unknown as SmwsCodeSeedFile,
  ): Promise<number> {
    const existing = new Set(
      (await this.repo.find({ select: { code: true }, withDeleted: true })).map(
        (r) => r.code,
      ),
    );
    const missing = seedRows(file).filter((r) => !existing.has(r.code));
    const rows: Partial<TasteepSmwsCode>[] = [];
    for (const r of missing) {
      const region = await this.regions.resolve(null, r.region);
      rows.push({ ...r, regionId: region?.id ?? null });
    }
    if (rows.length) {
      // orIgnore: another instance booting at the same time may insert first.
      await this.repo
        .createQueryBuilder()
        .insert()
        .values(rows)
        .orIgnore()
        .execute();
    }
    this.logger.log(
      `Seeded ${rows.length} new SMWS code(s); ${existing.size} already present.`,
    );
    return rows.length;
  }

  /** Every live code, in seed order, with its content hash. */
  async snapshot(): Promise<SmwsCodeSnapshot> {
    const rows = await this.repo.find();
    const items = rows.sort(bySnapshotOrder).map(toSmwsCodeJson);
    return { version: snapshotVersion(items), items };
  }

  async list(query: {
    q?: string;
    category?: string;
    include_deleted?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ items: AdminSmwsCodeJson[]; total: number }> {
    const qb = this.repo
      .createQueryBuilder('c')
      .orderBy('c.sortOrder', 'ASC')
      .addOrderBy('c.code', 'ASC')
      .skip(query.offset)
      .take(query.limit);
    if (query.include_deleted) qb.withDeleted();
    if (query.category) {
      qb.andWhere('c.category = :category', { category: query.category });
    }
    if (query.q) {
      qb.andWhere(
        '(c.code ILIKE :q OR c.distilleryName ILIKE :q OR c.extra ILIKE :q)',
        { q: `%${query.q}%` },
      );
    }
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(toAdminSmwsCodeJson), total };
  }

  /** `409` if the code is live; a soft-deleted code is brought back with the new values. */
  async create(dto: CreateSmwsCodeDto): Promise<AdminSmwsCodeJson> {
    const existing = await this.repo.findOne({
      where: { code: dto.code },
      withDeleted: true,
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`SMWS code ${dto.code} already exists.`);
    }
    const region = await this.regions.resolve(
      dto.region_id ?? null,
      dto.region ?? null,
    );
    const sortOrder = existing
      ? existing.sortOrder
      : await this.nextSortOrder();
    await this.repo.save(
      this.repo.create({
        code: dto.code,
        distilleryName: dto.distillery_name,
        category: dto.category,
        region: dto.region ?? null,
        regionId: region?.id ?? null,
        extra: dto.extra ?? null,
        sortOrder,
        deletedAt: null,
      }),
    );
    return toAdminSmwsCodeJson(await this.findLive(dto.code));
  }

  async update(
    code: string,
    dto: UpdateSmwsCodeDto,
  ): Promise<AdminSmwsCodeJson> {
    const row = await this.findLive(code);
    if (dto.distillery_name !== undefined) {
      row.distilleryName = dto.distillery_name;
    }
    if (dto.category !== undefined) row.category = dto.category;
    if (dto.extra !== undefined) row.extra = dto.extra;
    if (dto.region !== undefined) row.region = dto.region;

    if (dto.region_id !== undefined) {
      row.regionId = dto.region_id
        ? (await this.regions.resolve(dto.region_id, null))!.id
        : null;
    } else if (dto.region !== undefined) {
      row.regionId = (await this.regions.resolve(null, row.region))?.id ?? null;
    }
    await this.repo.save(row);
    return toAdminSmwsCodeJson(await this.findLive(code));
  }

  async remove(code: string): Promise<void> {
    await this.findLive(code);
    await this.repo.softDelete({ code });
  }

  async restore(code: string): Promise<AdminSmwsCodeJson> {
    const row = await this.repo.findOne({ where: { code }, withDeleted: true });
    if (!row) throw new NotFoundException(`Unknown SMWS code ${code}.`);
    if (row.deletedAt) await this.repo.restore({ code });
    return toAdminSmwsCodeJson(await this.findLive(code));
  }

  /**
   * Table vs seed file. `only_in_json` codes will be inserted on the next
   * boot; `deleted_in_table` ones won't (they were deleted on purpose).
   */
  async diff(
    file: SmwsCodeSeedFile = smwsCodeData as unknown as SmwsCodeSeedFile,
  ) {
    const json = seedRows(file);
    const rows = await this.repo.find({ withDeleted: true });
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const jsonCodes = new Set(json.map((r) => r.code));

    const onlyInJson: string[] = [];
    const deletedInTable: string[] = [];
    const changed: {
      code: string;
      fields: { field: string; json: string | null; table: string | null }[];
    }[] = [];
    for (const j of json) {
      const row = byCode.get(j.code);
      if (!row) {
        onlyInJson.push(j.code);
        continue;
      }
      if (row.deletedAt) {
        deletedInTable.push(j.code);
        continue;
      }
      const fields = COMPARED_FIELDS.filter(([key]) => j[key] !== row[key]).map(
        ([key, field]) => ({ field, json: j[key], table: row[key] }),
      );
      if (fields.length) changed.push({ code: j.code, fields });
    }
    const onlyInTable = rows
      .filter((r) => !r.deletedAt && !jsonCodes.has(r.code))
      .sort(bySnapshotOrder)
      .map((r) => r.code);

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

  /** Live rows in the seed file's format, to replace `smws-codes.json` with. */
  async exportSeedFile(): Promise<SmwsCodeSeedFile> {
    return toSeedFile(await this.repo.find());
  }

  private async findLive(code: string): Promise<TasteepSmwsCode> {
    const row = await this.repo.findOne({ where: { code } });
    if (!row) throw new NotFoundException(`Unknown SMWS code ${code}.`);
    return row;
  }

  private async nextSortOrder(): Promise<number> {
    const raw = await this.repo
      .createQueryBuilder('c')
      .withDeleted()
      .select('MAX(c.sortOrder)', 'max')
      .getRawOne<{ max: number | null }>();
    return (raw?.max ?? -1) + 1;
  }
}
