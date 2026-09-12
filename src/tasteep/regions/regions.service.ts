import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasteepRegion } from '../entities/tasteep-region.entity';
import * as regionData from '../data/region.json';

/** Shape of `src/tasteep/data/region.json`. */
export interface RegionSeedFile {
  regions: {
    main: string;
    lat: number;
    lon: number;
    sub: { name: string; lat: number; lon: number }[];
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

/**
 * Common spellings that are not the canonical name in the seed. Keys are
 * normalised (see `normalizeName`), values are region ids.
 */
const ALIASES: Record<string, string> = {
  highlands: 'scotland/highland',
  lowlands: 'scotland/lowland',
  usa: 'united-states',
  us: 'united-states',
  'united states of america': 'united-states',
};

/** `"Cork County"` → `"cork-county"`; strips diacritics, keeps `[a-z0-9]`. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Case/whitespace-insensitive key used to match typed text against names. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Builds the rows the seed file describes, parents before children. */
export function seedRows(file: RegionSeedFile): TasteepRegion[] {
  const rows: TasteepRegion[] = [];
  file.regions.forEach((country, i) => {
    const countryId = slugify(country.main);
    rows.push({
      id: countryId,
      name: country.main,
      parentId: null,
      parent: null,
      lat: country.lat,
      lon: country.lon,
      sortOrder: i,
    });
    country.sub.forEach((sub, j) => {
      rows.push({
        id: `${countryId}/${slugify(sub.name)}`,
        name: sub.name,
        parentId: countryId,
        parent: null,
        lat: sub.lat,
        lon: sub.lon,
        sortOrder: j,
      });
    });
  });
  return rows;
}

/**
 * The curated region picker. Seeds `tasteep_regions` from `region.json` at
 * boot (upsert by slug — rows are never deleted automatically, so removing an
 * entry from the file leaves the row and any tastings pointing at it intact)
 * and resolves what a tasting typed or picked to a row.
 */
@Injectable()
export class RegionsService implements OnModuleInit {
  private readonly logger = new Logger(RegionsService.name);

  constructor(
    @InjectRepository(TasteepRegion)
    private readonly repo: Repository<TasteepRegion>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  async seed(
    file: RegionSeedFile = regionData as RegionSeedFile,
  ): Promise<number> {
    const rows = seedRows(file);
    const parents = rows.filter((r) => r.parentId === null);
    const children = rows.filter((r) => r.parentId !== null);
    // Parents first so the self-referencing FK is satisfied.
    await this.repo.upsert(parents, ['id']);
    if (children.length) await this.repo.upsert(children, ['id']);
    this.logger.log(
      `Seeded ${parents.length} regions and ${children.length} subregions.`,
    );
    return rows.length;
  }

  /** Countries in seed order, each with its subregions in seed order. */
  async tree(): Promise<RegionJson[]> {
    const rows = await this.repo.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const byParent = new Map<string, TasteepRegion[]>();
    for (const r of rows) {
      if (r.parentId === null) continue;
      const list = byParent.get(r.parentId) ?? [];
      list.push(r);
      byParent.set(r.parentId, list);
    }
    const toJson = (r: TasteepRegion): SubregionJson => ({
      id: r.id,
      name: r.name,
      lat: r.lat ?? null,
      lon: r.lon ?? null,
    });
    return rows
      .filter((r) => r.parentId === null)
      .map((country) => ({
        ...toJson(country),
        subregions: (byParent.get(country.id) ?? []).map(toJson),
      }));
  }

  /**
   * What a tasting should link to.
   *  - `regionId` given → that row; `400` if it does not exist.
   *  - otherwise `regionText` is matched case-insensitively against names and
   *    aliases, whole first, then each `,`/`/`-separated part (so both
   *    "Islay" and "Islay, Scotland" link to `scotland/islay`). A subregion
   *    beats its country when both appear.
   *  - nothing matched → `null`; the free text is kept on the tasting as is.
   */
  async resolve(
    regionId: string | null | undefined,
    regionText: string | null | undefined,
  ): Promise<TasteepRegion | null> {
    if (regionId) {
      const row = await this.repo.findOne({ where: { id: regionId } });
      if (!row) {
        throw new BadRequestException(`Unknown region_id "${regionId}".`);
      }
      return row;
    }

    const text = normalizeName(regionText ?? '');
    if (!text) return null;

    const rows = await this.repo.find();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const candidates = [
      text,
      ...text
        .split(/[,/|()]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ];

    const matches: TasteepRegion[] = [];
    for (const candidate of candidates) {
      const alias = ALIASES[candidate];
      const aliased = alias ? byId.get(alias) : undefined;
      if (aliased) matches.push(aliased);
      matches.push(...rows.filter((r) => normalizeName(r.name) === candidate));
    }
    if (!matches.length) return null;

    // Stable sort: subregions first, otherwise keep first-seen order.
    return matches.sort(
      (a, b) => Number(a.parentId === null) - Number(b.parentId === null),
    )[0];
  }
}
