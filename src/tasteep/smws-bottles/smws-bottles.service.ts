import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import { TasteepSmwsPage } from '../entities/tasteep-smws-page.entity';
import { TasteepSmwsScrapeRun } from '../entities/tasteep-smws-scrape-run.entity';
import {
  SmwsBottleJson,
  SmwsBottlePage,
  SmwsScrapeRunJson,
  toSmwsBottleJson,
  toSmwsScrapeRunJson,
} from './smws-bottle.mapper';
import { SmwsBottleSyncService } from './smws-bottle-sync.service';
import {
  BottleSearch,
  BottleSearchQuery,
  FOLD_FROM,
  FOLD_TO,
  LIST_DEFAULTS,
  likeEscape,
  parseBottleSearch,
  Range,
  SEARCH_DEFAULTS,
  SearchDefaults,
} from './smws-bottle.search';

/** SQL fold of `fold()`: lowercase, common accents removed. */
const folded = (sql: string) => `translate(lower(${sql}), :foldFrom, :foldTo)`;

/** Everything the free text is looked up in. */
const HAYSTACK = folded(
  "concat_ws(' ', b.code, b.name, b.batch, c.distillery_name, b.region_text, r.name, b.cask_type, b.profile, b.age)",
);

/** `14 years` → 14; `null` for `16 & 21 years` or no age. */
const AGE_YEARS = "substring(b.age from '^(\\d+) years?$')::int";

/** Values the app can offer as filters, with how many bottles have each. */
export interface SmwsBottleFacets {
  kinds: { value: string; count: number }[];
  /** `tasteep_smws_codes` categories: `single malt`, `rum`, `bourbon`… */
  categories: { value: string; count: number }[];
  /** Spelling variants merged (`Deep, Rich & Dried Fruits` / `Deep Rich & …`). */
  profiles: { value: string; count: number }[];
  abv: { min: number | null; max: number | null };
  age: { min: number | null; max: number | null };
  price: { min: number | null; max: number | null };
  distilled_years: { min: number | null; max: number | null };
  released_years: { min: number | null; max: number | null };
}

export interface SmwsAdminStatus {
  bottles: {
    total: number;
    available: number;
    /** Sold out: our archive. */
    delisted: number;
    single_casks: number;
    blends: number;
    /** Tasting packs, gift sets, gin, rum, beer… */
    others: number;
    without_region: number;
    /** Single casks whose code prefix is missing from `tasteep_smws_codes`. */
    unknown_distillery: number;
    last_seen_at: string | null;
  };
  /** Sitemap URLs read so far, by what they turned out to be. */
  pages: { bottle: number; other: number; gone: number };
  scraper: { running: boolean; recent_runs: SmwsScrapeRunJson[] };
}

type CountsRow = {
  total: string;
  available: string;
  single_casks: string;
  blends: string;
  without_region: string;
  unknown_distillery: string;
  last_seen_at: Date | null;
};

/** Reads `tasteep_smws_catalog` for the app and the admin dashboard. */
@Injectable()
export class SmwsBottlesService {
  constructor(
    @InjectRepository(TasteepSmwsBottle)
    private readonly bottles: Repository<TasteepSmwsBottle>,
    @InjectRepository(TasteepSmwsScrapeRun)
    private readonly runs: Repository<TasteepSmwsScrapeRun>,
    @InjectRepository(TasteepSmwsPage)
    private readonly pages: Repository<TasteepSmwsPage>,
    private readonly sync: SmwsBottleSyncService,
  ) {}

  /**
   * The shop's list: available bottles by default, newest release first,
   * 50 per page. Takes every filter of `search`.
   */
  list(query: BottleSearchQuery = {}): Promise<SmwsBottlePage> {
    return this.find(query, LIST_DEFAULTS);
  }

  /**
   * Finds bottles by any field, for the app's bottle picker: every bottle ever
   * seen (sold-out ones included, since that is most of what people taste),
   * best match first, 20 per page. `q` is a cask code or its start (`5.13`),
   * a distillery code (`29`), or words found anywhere in the bottle (`smoke`,
   * `glenfarclas oloroso`); the other parameters narrow by field.
   */
  search(query: BottleSearchQuery = {}): Promise<SmwsBottlePage> {
    return this.find(query, SEARCH_DEFAULTS);
  }

  private async find(
    query: BottleSearchQuery,
    defaults: SearchDefaults,
  ): Promise<SmwsBottlePage> {
    const search = parseBottleSearch(query, defaults);
    const qb = this.bottles
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.smwsCode', 'c')
      .leftJoin('b.regionRef', 'r')
      .setParameters({ foldFrom: FOLD_FROM, foldTo: FOLD_TO });
    applyFilters(qb, search);
    applyOrder(qb, search);
    // Both joins are many-to-one (one row per bottle), so a plain LIMIT is
    // exact and leaves raw ORDER BY expressions alone, unlike skip/take.
    qb.offset(search.offset).limit(search.limit);
    const [rows, total] = await qb.getManyAndCount();
    return { total, items: rows.map(toSmwsBottleJson) };
  }

  /** Filter values and ranges over the whole catalog, for the app's filter sheet. */
  async facets(): Promise<SmwsBottleFacets> {
    const counts = (rows: { value: string; n: string }[]) =>
      rows.map((r) => ({ value: r.value, count: Number(r.n) }));
    const [kinds, categories, profiles, ranges] = await Promise.all([
      this.bottles
        .createQueryBuilder('b')
        .select('b.kind', 'value')
        .addSelect('COUNT(*)', 'n')
        .groupBy('b.kind')
        .orderBy('n', 'DESC')
        .getRawMany<{ value: string; n: string }>(),
      this.bottles
        .createQueryBuilder('b')
        .innerJoin('b.smwsCode', 'c')
        .select('c.category', 'value')
        .addSelect('COUNT(*)', 'n')
        .groupBy('c.category')
        .orderBy('n', 'DESC')
        .getRawMany<{ value: string; n: string }>(),
      this.bottles
        .createQueryBuilder('b')
        .select('mode() WITHIN GROUP (ORDER BY b.profile)', 'value')
        .addSelect('COUNT(*)', 'n')
        .where('b.profile IS NOT NULL')
        .groupBy(`regexp_replace(${folded('b.profile')}, '[^a-z]', '', 'g')`)
        .orderBy('n', 'DESC')
        .setParameters({ foldFrom: FOLD_FROM, foldTo: FOLD_TO })
        .getRawMany<{ value: string; n: string }>(),
      this.bottles
        .createQueryBuilder('b')
        .select('MIN(b.abv)', 'abv_min')
        .addSelect('MAX(b.abv)', 'abv_max')
        .addSelect(`MIN(${AGE_YEARS})`, 'age_min')
        .addSelect(`MAX(${AGE_YEARS})`, 'age_max')
        .addSelect('MIN(b.price_amount)', 'price_min')
        .addSelect('MAX(b.price_amount)', 'price_max')
        .addSelect('MIN(EXTRACT(YEAR FROM b.distilled_date))', 'distilled_min')
        .addSelect('MAX(EXTRACT(YEAR FROM b.distilled_date))', 'distilled_max')
        .addSelect('MIN(EXTRACT(YEAR FROM b.released_at))', 'released_min')
        .addSelect('MAX(EXTRACT(YEAR FROM b.released_at))', 'released_max')
        .getRawOne<Record<string, string | null>>(),
    ]);
    const num = (key: string) =>
      ranges?.[key] == null ? null : Number(ranges[key]);
    const span = (key: string) => ({
      min: num(`${key}_min`),
      max: num(`${key}_max`),
    });
    return {
      kinds: counts(kinds),
      categories: counts(categories),
      profiles: counts(profiles),
      abv: span('abv'),
      age: span('age'),
      price: span('price'),
      distilled_years: span('distilled'),
      released_years: span('released'),
    };
  }

  /** By cask code (`1.309`) or SKU. */
  async get(id: string): Promise<SmwsBottleJson> {
    return toSmwsBottleJson(await this.findRow(id));
  }

  /** The stored bottle by cask code (`1.309`) or SKU; `404` if unknown. */
  async findRow(id: string): Promise<TasteepSmwsBottle> {
    const row = await this.findRowOrNull(id);
    if (!row) throw new NotFoundException(`No SMWS bottle "${id}".`);
    return row;
  }

  /** The stored bottle by cask code (`1.309`) or SKU, with its distillery. */
  findRowOrNull(id: string): Promise<TasteepSmwsBottle | null> {
    const key = id.trim();
    return this.bottles.findOne({
      where: /^[A-Za-z]*\d+\.\d+$/.test(key)
        ? { code: key.toUpperCase() }
        : { sku: key },
      relations: { smwsCode: true },
    });
  }

  async adminStatus(): Promise<SmwsAdminStatus> {
    const [counts, recent, pageRows] = await Promise.all([
      this.bottles
        .createQueryBuilder('b')
        .leftJoin('b.smwsCode', 'c')
        .select('COUNT(*)', 'total')
        .addSelect('COUNT(*) FILTER (WHERE b.in_stock)', 'available')
        .addSelect(
          "COUNT(*) FILTER (WHERE b.kind = 'single_cask')",
          'single_casks',
        )
        .addSelect("COUNT(*) FILTER (WHERE b.kind = 'blend')", 'blends')
        .addSelect(
          'COUNT(*) FILTER (WHERE b.region_id IS NULL)',
          'without_region',
        )
        .addSelect(
          "COUNT(*) FILTER (WHERE b.kind = 'single_cask' AND c.code IS NULL)",
          'unknown_distillery',
        )
        .addSelect('MAX(b.last_seen_at)', 'last_seen_at')
        .getRawOne<CountsRow>(),
      this.runs.find({ order: { startedAt: 'DESC' }, take: 10 }),
      this.pages
        .createQueryBuilder('p')
        .select('p.kind', 'kind')
        .addSelect('COUNT(*)', 'n')
        .groupBy('p.kind')
        .getRawMany<{ kind: string; n: string }>(),
    ]);
    // Aggregates without GROUP BY always yield exactly one row.
    if (!counts) throw new Error('No stats row');
    const total = Number(counts.total);
    const available = Number(counts.available);
    const singleCasks = Number(counts.single_casks);
    const pageCount = (kind: string) =>
      Number(pageRows.find((r) => r.kind === kind)?.n ?? 0);
    return {
      bottles: {
        total,
        available,
        delisted: total - available,
        single_casks: singleCasks,
        blends: Number(counts.blends),
        others: total - singleCasks - Number(counts.blends),
        without_region: Number(counts.without_region),
        unknown_distillery: Number(counts.unknown_distillery),
        last_seen_at: counts.last_seen_at
          ? new Date(counts.last_seen_at).toISOString()
          : null,
      },
      pages: {
        bottle: pageCount('bottle'),
        other: pageCount('other'),
        gone: pageCount('gone'),
      },
      scraper: {
        running: this.sync.isRunning(),
        recent_runs: recent.map(toSmwsScrapeRunJson),
      },
    };
  }
}

function applyRange(
  qb: SelectQueryBuilder<TasteepSmwsBottle>,
  sql: string,
  name: string,
  range: Range,
) {
  if (range.min !== null) {
    qb.andWhere(`${sql} >= :${name}Min`, { [`${name}Min`]: range.min });
  }
  if (range.max !== null) {
    qb.andWhere(`${sql} <= :${name}Max`, { [`${name}Max`]: range.max });
  }
}

function applyFilters(
  qb: SelectQueryBuilder<TasteepSmwsBottle>,
  s: BottleSearch,
) {
  if (s.status === 'available') qb.andWhere('b.in_stock = true');
  if (s.status === 'delisted') qb.andWhere('b.in_stock = false');
  if (s.kind) qb.andWhere('b.kind = :kind', { kind: s.kind });
  if (s.category) {
    qb.andWhere('c.category = :category', { category: s.category });
  }
  if (s.distilleryCode) {
    qb.andWhere('b.distillery_code = :code', { code: s.distilleryCode });
  }
  if (s.regionId) {
    qb.andWhere('(b.region_id = :rid OR r.parent_id = :rid)', {
      rid: s.regionId,
    });
  }
  if (s.profileKey) {
    qb.andWhere(
      `regexp_replace(${folded('b.profile')}, '[^a-z]', '', 'g') = :profileKey`,
      { profileKey: s.profileKey },
    );
  }
  s.caskWords.forEach((word, i) =>
    qb.andWhere(`${folded('b.cask_type')} LIKE :cask${i}`, {
      [`cask${i}`]: `%${likeEscape(word)}%`,
    }),
  );
  applyRange(qb, 'b.abv', 'abv', s.abv);
  applyRange(qb, AGE_YEARS, 'age', s.age);
  applyRange(qb, 'b.price_amount', 'price', s.price);
  applyRange(
    qb,
    'EXTRACT(YEAR FROM b.distilled_date)',
    'distilled',
    s.distilledYears,
  );
  applyRange(
    qb,
    'EXTRACT(YEAR FROM b.released_at)',
    'released',
    s.releasedYears,
  );

  const text = s.text;
  if (text?.type === 'code') {
    qb.andWhere('b.code LIKE :codePrefix', {
      codePrefix: `${likeEscape(text.code)}%`,
    });
  } else if (text) {
    text.words.forEach((word, i) =>
      qb.andWhere(`${HAYSTACK} LIKE :word${i}`, {
        [`word${i}`]: `%${likeEscape(word)}%`,
      }),
    );
  }
}

/**
 * Sort keys are selected as aliases and ordered by alias: TypeORM leaves
 * those untouched, where it would rewrite or reject raw expressions.
 */
function applyOrder(
  qb: SelectQueryBuilder<TasteepSmwsBottle>,
  s: BottleSearch,
) {
  const by = (sql: string, alias: string, order: 'ASC' | 'DESC') => {
    // Parenthesized: a bare `b.sku` would be read as the entity's own column.
    qb.addSelect(`(${sql})`, alias).addOrderBy(alias, order, 'NULLS LAST');
  };
  const text = s.text;
  if (s.sort === 'relevance' && text?.type === 'code') {
    // `5.1` lists 5.1, then 5.10–5.19, then 5.100…: shortest code first.
    by('length(b.code)', 'sort_rank', 'ASC');
    by('b.code', 'sort_code', 'ASC');
  } else if (s.sort === 'relevance' && text?.type === 'words') {
    const name = folded('b.name');
    qb.setParameters({
      qExact: text.folded,
      qStart: `${likeEscape(text.folded)}%`,
      qAny: `%${likeEscape(text.folded)}%`,
      qCode: text.distilleryCode,
    });
    by(
      `CASE
        WHEN b.distillery_code = :qCode THEN 0
        WHEN ${name} = :qExact THEN 1
        WHEN ${name} LIKE :qStart THEN 2
        WHEN ${name} LIKE :qAny THEN 3
        WHEN ${folded('c.distillery_name')} LIKE :qStart THEN 4
        ELSE 5
      END`,
      'sort_rank',
      'ASC',
    );
  } else if (s.sort === 'abv') {
    by('b.abv', 'sort_value', s.order);
  } else if (s.sort === 'age') {
    by(AGE_YEARS, 'sort_value', s.order);
  } else if (s.sort === 'price') {
    by('b.price_amount', 'sort_value', s.order);
  } else if (s.sort === 'distilled') {
    by('b.distilled_date', 'sort_value', s.order);
  } else if (s.status === 'delisted') {
    // The archive: most recently sold out first.
    by('b.delisted_at', 'sort_value', 'DESC');
  }
  by(
    'b.released_at',
    'sort_released',
    s.sort === 'released' ? s.order : 'DESC',
  );
  by('b.first_seen_at', 'sort_seen', 'DESC');
  by('b.sku', 'sort_sku', 'ASC');
}
