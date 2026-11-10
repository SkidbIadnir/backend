import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SMWS_BOTTLE_KINDS,
  SmwsBottleKind,
  TasteepSmwsBottle,
} from '../entities/tasteep-smws-bottle.entity';
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

export const BOTTLE_STATUSES = ['available', 'delisted', 'all'] as const;
export type BottleStatus = (typeof BOTTLE_STATUSES)[number];

export interface ListBottlesQuery {
  status?: string;
  kind?: string;
  distillery_code?: string;
  region_id?: string;
  limit?: string;
  offset?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseIntParam(
  name: string,
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new BadRequestException(
      `${name} must be an integer between 0 and ${max}.`,
    );
  }
  return n;
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
   * `status` (default `available`), `kind` (`single_cask`, `blend`, `other`),
   * `distillery_code` (`1`, `G1`), `region_id` (a country also matches its
   * subregions), `limit` (≤ 200), `offset`. Newest release first; sold-out
   * bottles most recently sold out first.
   */
  async list(query: ListBottlesQuery = {}): Promise<SmwsBottlePage> {
    const status = (query.status || 'available') as BottleStatus;
    if (!BOTTLE_STATUSES.includes(status)) {
      throw new BadRequestException(
        `status must be one of ${BOTTLE_STATUSES.join(', ')}.`,
      );
    }
    if (
      query.kind &&
      !SMWS_BOTTLE_KINDS.includes(query.kind as SmwsBottleKind)
    ) {
      throw new BadRequestException(
        `kind must be one of ${SMWS_BOTTLE_KINDS.join(', ')}.`,
      );
    }
    const limit = parseIntParam('limit', query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parseIntParam(
      'offset',
      query.offset,
      0,
      Number.MAX_SAFE_INTEGER,
    );

    const qb = this.bottles
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.smwsCode', 'c')
      .leftJoin('b.regionRef', 'r');
    if (status === 'available') qb.andWhere('b.in_stock = true');
    if (status === 'delisted') qb.andWhere('b.in_stock = false');
    if (query.kind) qb.andWhere('b.kind = :kind', { kind: query.kind });
    if (query.distillery_code) {
      qb.andWhere('b.distillery_code = :code', {
        code: query.distillery_code.trim().toUpperCase(),
      });
    }
    if (query.region_id) {
      qb.andWhere('(b.region_id = :rid OR r.parent_id = :rid)', {
        rid: query.region_id,
      });
    }
    // Property names, not column names: with a join plus skip/take, TypeORM
    // resolves ORDER BY through the entity metadata and fails on column names.
    if (status === 'delisted') qb.orderBy('b.delistedAt', 'DESC', 'NULLS LAST');
    qb.addOrderBy('b.releasedAt', 'DESC', 'NULLS LAST')
      .addOrderBy('b.firstSeenAt', 'DESC')
      .addOrderBy('b.sku', 'ASC')
      .skip(offset)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return { total, items: rows.map(toSmwsBottleJson) };
  }

  /** By cask code (`1.309`) or SKU. */
  async get(id: string): Promise<SmwsBottleJson> {
    const key = id.trim();
    const row = await this.bottles.findOne({
      where: /^[A-Za-z]*\d+\.\d+$/.test(key)
        ? { code: key.toUpperCase() }
        : { sku: key },
      relations: { smwsCode: true },
    });
    if (!row) throw new NotFoundException(`No SMWS bottle "${id}".`);
    return toSmwsBottleJson(row);
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
