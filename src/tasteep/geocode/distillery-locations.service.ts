import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { TasteepDistilleryLocation } from '../entities/tasteep-distillery-location.entity';
import { TasteepGeocodeCache } from '../entities/tasteep-geocode-cache.entity';
import {
  TasteepTasting,
  UNPLACED_PRECISIONS,
} from '../entities/tasteep-tasting.entity';
import { slugify } from '../regions/regions.service';
import {
  CreateDistilleryLocationDto,
  UpdateDistilleryLocationDto,
} from './dto/distillery-location.dto';
import { normalizeQuery } from './normalize-query';
import * as distilleryData from '../data/distillery-location.json';

/** Shape of `src/tasteep/data/distillery-location.json`. */
export interface DistillerySeedFile {
  _comment?: string;
  distilleries: {
    /** Only when it isn't `slugify(name)`, i.e. the row was renamed after creation. */
    id?: string;
    name: string;
    lat: number;
    lon: number;
    precision: 'exact' | 'region' | 'country';
    /** Free-text provenance, kept by the export; not stored in the table. */
    _note?: string;
  }[];
}

/** Admin view of a row. */
export interface AdminDistilleryLocationJson {
  id: string;
  name: string;
  lat: number;
  lon: number;
  precision: TasteepDistilleryLocation['precision'];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** A write that may change what geocoding returns, with the number of cache rows it invalidated. */
export interface AdminDistilleryLocationWriteJson extends AdminDistilleryLocationJson {
  cache_cleared: number;
}

type SeedRow = Pick<
  TasteepDistilleryLocation,
  'id' | 'name' | 'lat' | 'lon' | 'precision'
>;

/** Fields the seed file and the table both carry, compared by `diff`. */
const COMPARED_FIELDS = ['name', 'lat', 'lon', 'precision'] as const;

/** Builds the rows the seed file describes, keyed on a stable slug id. */
export function seedRows(file: DistillerySeedFile): SeedRow[] {
  return file.distilleries.map((d) => ({
    id: d.id ?? slugify(d.name),
    name: d.name,
    lat: d.lat,
    lon: d.lon,
    precision: d.precision,
  }));
}

export const toAdminDistilleryLocationJson = (
  r: TasteepDistilleryLocation,
): AdminDistilleryLocationJson => ({
  id: r.id,
  name: r.name,
  lat: r.lat,
  lon: r.lon,
  precision: r.precision,
  created_at: r.createdAt.toISOString(),
  updated_at: r.updatedAt.toISOString(),
  deleted_at: r.deletedAt ? r.deletedAt.toISOString() : null,
});

/**
 * True when a normalized geocode query names this distillery: the query
 * equals the normalized name, or starts with it followed by any
 * non-alphanumeric separator (space, comma, "·", ...) — so "ardbeg · islay"
 * and "ardbeg, islay" both match "ardbeg", while "ardbegxyz" doesn't.
 */
export function matchesName(normalizedQuery: string, name: string): boolean {
  const n = normalizeQuery(name);
  if (!n) return false;
  if (normalizedQuery === n) return true;
  return (
    normalizedQuery.startsWith(n) &&
    !/[a-z0-9]/i.test(normalizedQuery[n.length] ?? '')
  );
}

/** The matching row with the longest name, so "Glen Scotia" beats "Glen". */
export function bestMatch<T extends { name: string }>(
  normalizedQuery: string,
  rows: T[],
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!matchesName(normalizedQuery, row.name)) continue;
    if (
      !best ||
      normalizeQuery(row.name).length > normalizeQuery(best.name).length
    ) {
      best = row;
    }
  }
  return best;
}

/** Turns live rows back into the seed file's format, keeping the bundled file's comments. */
export function toSeedFile(
  rows: TasteepDistilleryLocation[],
  bundled: DistillerySeedFile,
): DistillerySeedFile {
  const notes = new Map(
    seedRows(bundled).map((r, i) => [r.id, bundled.distilleries[i]._note]),
  );
  return {
    ...(bundled._comment ? { _comment: bundled._comment } : {}),
    distilleries: [...rows]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => {
        const note = notes.get(r.id);
        return {
          ...(slugify(r.name) !== r.id ? { id: r.id } : {}),
          name: r.name,
          lat: r.lat,
          lon: r.lon,
          precision: r.precision,
          ...(note ? { _note: note } : {}),
        };
      }),
  };
}

/**
 * Hand-curated distillery coordinates, checked before Nominatim in
 * `GeocodeService` for names Nominatim resolves ambiguously, wrongly, or not
 * at all. Seeds `tasteep_distillery_locations` from
 * `distillery-location.json` at boot (missing ids only, so dashboard edits
 * and deletes survive restarts) and backs `/admin/distillery-locations`.
 *
 * Every write clears the `tasteep_geocode_cache` rows the name matches:
 * misses are cached forever, so without this a new curated row would never
 * be consulted for a query that already missed.
 */
@Injectable()
export class DistilleryLocationsService implements OnModuleInit {
  private readonly logger = new Logger(DistilleryLocationsService.name);

  constructor(
    @InjectRepository(TasteepDistilleryLocation)
    private readonly repo: Repository<TasteepDistilleryLocation>,
    @InjectRepository(TasteepGeocodeCache)
    private readonly cacheRepo: Repository<TasteepGeocodeCache>,
    @InjectRepository(TasteepTasting)
    private readonly tastingRepo: Repository<TasteepTasting>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /** Inserts the file's ids that the table doesn't have, deleted rows included. */
  async seed(
    file: DistillerySeedFile = distilleryData as DistillerySeedFile,
  ): Promise<number> {
    const existing = new Set(
      (await this.repo.find({ select: { id: true }, withDeleted: true })).map(
        (r) => r.id,
      ),
    );
    const rows = seedRows(file).filter((r) => !existing.has(r.id));
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
      `Seeded ${rows.length} new distillery location(s); ${existing.size} already present.`,
    );
    return rows.length;
  }

  /**
   * Matches a normalized geocode query (see `normalizeQuery`) against the
   * live rows of the curated table; see `matchesName` and `bestMatch`.
   */
  async match(
    normalizedQuery: string,
  ): Promise<TasteepDistilleryLocation | null> {
    return bestMatch(normalizedQuery, await this.repo.find());
  }

  async list(query: {
    q?: string;
    include_deleted?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ items: AdminDistilleryLocationJson[]; total: number }> {
    const qb = this.repo
      .createQueryBuilder('d')
      .orderBy('d.name', 'ASC')
      .addOrderBy('d.id', 'ASC')
      .skip(query.offset)
      .take(query.limit);
    if (query.include_deleted) qb.withDeleted();
    if (query.q) {
      qb.andWhere('(d.name ILIKE :q OR d.id ILIKE :q)', { q: `%${query.q}%` });
    }
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(toAdminDistilleryLocationJson), total };
  }

  /** `409` if the id is live; a soft-deleted id is brought back with the new values. */
  async create(
    dto: CreateDistilleryLocationDto,
  ): Promise<AdminDistilleryLocationWriteJson> {
    const id = slugify(dto.name);
    if (!id) {
      throw new BadRequestException('name must contain a letter or digit.');
    }
    const existing = await this.repo.findOne({
      where: { id },
      withDeleted: true,
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(
        `Distillery location "${id}" already exists.`,
      );
    }
    await this.repo.save(
      this.repo.create({
        id,
        name: dto.name,
        lat: dto.lat,
        lon: dto.lon,
        precision: dto.precision,
        deletedAt: null,
      }),
    );
    const names = existing ? [existing.name, dto.name] : [dto.name];
    return this.withCacheCleared(await this.findLive(id), names);
  }

  async update(
    id: string,
    dto: UpdateDistilleryLocationDto,
  ): Promise<AdminDistilleryLocationWriteJson> {
    const row = await this.findLive(id);
    const oldName = row.name;
    if (dto.name !== undefined) row.name = dto.name;
    if (dto.lat !== undefined) row.lat = dto.lat;
    if (dto.lon !== undefined) row.lon = dto.lon;
    if (dto.precision !== undefined) row.precision = dto.precision;
    await this.repo.save(row);
    // The old name too: its cached `curated` hits carry the old coordinates.
    return this.withCacheCleared(await this.findLive(id), [oldName, row.name]);
  }

  /** Soft delete. Clears the cache too, or cached `curated` hits would keep serving the row. */
  async remove(id: string): Promise<{ cache_cleared: number }> {
    const row = await this.findLive(id);
    await this.repo.softDelete({ id });
    return { cache_cleared: await this.clearCache([row.name]) };
  }

  async restore(id: string): Promise<AdminDistilleryLocationWriteJson> {
    const row = await this.repo.findOne({ where: { id }, withDeleted: true });
    if (!row) throw new NotFoundException(`Unknown distillery location ${id}.`);
    if (row.deletedAt) await this.repo.restore({ id });
    return this.withCacheCleared(await this.findLive(id), [row.name]);
  }

  /**
   * Places the tastings that are still unplaced (`unknown` / `country`) and
   * whose distillery this row matches — the same rule geocoding uses, so a
   * tasting another curated row matches better is left alone. `manual` pins
   * are never unplaced, so never touched.
   */
  async apply(id: string): Promise<{ id: string; updated: number }> {
    const location = await this.findLive(id);
    const prefix = normalizeQuery(location.name);
    const candidates = await this.tastingRepo
      .createQueryBuilder('t')
      .select(['t.id', 't.distillery'])
      .where('t.locationPrecision IN (:...unplaced)', {
        unplaced: UNPLACED_PRECISIONS,
      })
      .andWhere(
        `left(lower(regexp_replace(trim(t.distillery), '\\s+', ' ', 'g')), :len) = :prefix`,
        { len: prefix.length, prefix },
      )
      .getMany();
    if (!candidates.length) return { id, updated: 0 };

    const locations = await this.repo.find();
    const ids = candidates
      .filter(
        (t) =>
          bestMatch(normalizeQuery(t.distillery ?? ''), locations)?.id === id,
      )
      .map((t) => t.id);
    if (!ids.length) return { id, updated: 0 };

    const result = await this.tastingRepo.update(
      { id: In(ids), locationPrecision: In(UNPLACED_PRECISIONS) },
      {
        lat: location.lat,
        lon: location.lon,
        locationPrecision: location.precision,
      },
    );
    return { id, updated: result.affected ?? 0 };
  }

  /**
   * Table vs seed file. `only_in_json` ids will be inserted on the next
   * boot; `deleted_in_table` ones won't (they were deleted on purpose).
   */
  async diff(file: DistillerySeedFile = distilleryData as DistillerySeedFile) {
    const json = seedRows(file);
    const rows = await this.repo.find({ withDeleted: true });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const jsonIds = new Set(json.map((r) => r.id));

    const onlyInJson: string[] = [];
    const deletedInTable: string[] = [];
    const changed: {
      id: string;
      fields: {
        field: string;
        json: string | number | null;
        table: string | number | null;
      }[];
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
      const fields = COMPARED_FIELDS.filter((f) => j[f] !== row[f]).map(
        (f) => ({ field: f, json: j[f], table: row[f] }),
      );
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

  /** Live rows in the seed file's format, to replace `distillery-location.json` with. */
  async exportSeedFile(
    bundled: DistillerySeedFile = distilleryData as DistillerySeedFile,
  ): Promise<DistillerySeedFile> {
    return toSeedFile(await this.repo.find(), bundled);
  }

  /**
   * Deletes the geocode cache rows any of `names` matches (see `matchesName`),
   * hits and misses alike, so the next lookup goes through `match` again.
   */
  async clearCache(names: string[]): Promise<number> {
    const keys = [...new Set(names.map(normalizeQuery))].filter(Boolean);
    if (!keys.length) return 0;
    const qb = this.cacheRepo.createQueryBuilder().delete();
    qb.where(
      new Brackets((w) => {
        keys.forEach((key, i) => {
          w.orWhere(
            `(query = :k${i} OR (left(query, :l${i}) = :k${i} AND substr(query, :l${i} + 1, 1) !~ '[a-z0-9]'))`,
            { [`k${i}`]: key, [`l${i}`]: key.length },
          );
        });
      }),
    );
    const result = await qb.execute();
    const cleared = result.affected ?? 0;
    if (cleared) {
      this.logger.log(
        `Cleared ${cleared} geocode cache row(s) for ${keys.map((k) => `"${k}"`).join(', ')}.`,
      );
    }
    return cleared;
  }

  private async withCacheCleared(
    row: TasteepDistilleryLocation,
    names: string[],
  ): Promise<AdminDistilleryLocationWriteJson> {
    return {
      ...toAdminDistilleryLocationJson(row),
      cache_cleared: await this.clearCache(names),
    };
  }

  private async findLive(id: string): Promise<TasteepDistilleryLocation> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Unknown distillery location ${id}.`);
    return row;
  }
}
