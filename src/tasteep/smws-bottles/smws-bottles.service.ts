import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
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
    delisted: number;
    without_region: number;
    unknown_distillery: number;
    last_seen_at: string | null;
  };
  scraper: { running: boolean; recent_runs: SmwsScrapeRunJson[] };
}

type CountsRow = {
  total: string;
  available: string;
  without_region: string;
  unknown_distillery: string;
  last_seen_at: Date | null;
};

/** Reads `tasteep_smws_bottles` for the app and the admin dashboard. */
@Injectable()
export class SmwsBottlesService {
  constructor(
    @InjectRepository(TasteepSmwsBottle)
    private readonly bottles: Repository<TasteepSmwsBottle>,
    @InjectRepository(TasteepSmwsScrapeRun)
    private readonly runs: Repository<TasteepSmwsScrapeRun>,
    private readonly sync: SmwsBottleSyncService,
  ) {}

  /**
   * `status` (default `available`), `distillery_code` (`1`, `G1`),
   * `region_id` (a country also matches its subregions), `limit` (≤ 200),
   * `offset`. Available bottles come newest first, delisted ones most
   * recently delisted first.
   */
  async list(query: ListBottlesQuery = {}): Promise<SmwsBottlePage> {
    const status = (query.status || 'available') as BottleStatus;
    if (!BOTTLE_STATUSES.includes(status)) {
      throw new BadRequestException(
        `status must be one of ${BOTTLE_STATUSES.join(', ')}.`,
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
    if (status === 'available') qb.andWhere('b.delisted_at IS NULL');
    if (status === 'delisted') qb.andWhere('b.delisted_at IS NOT NULL');
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
    if (status === 'delisted') {
      qb.orderBy('b.delistedAt', 'DESC');
    } else {
      qb.orderBy('b.firstSeenAt', 'DESC');
    }
    qb.addOrderBy('b.code', 'ASC').skip(offset).take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return { total, items: rows.map(toSmwsBottleJson) };
  }

  async get(code: string): Promise<SmwsBottleJson> {
    const row = await this.bottles.findOne({
      where: { code: code.trim().toUpperCase() },
      relations: { smwsCode: true },
    });
    if (!row) throw new NotFoundException(`No SMWS bottle "${code}".`);
    return toSmwsBottleJson(row);
  }

  async adminStatus(): Promise<SmwsAdminStatus> {
    const [counts, recent] = await Promise.all([
      this.bottles
        .createQueryBuilder('b')
        .leftJoin('b.smwsCode', 'c')
        .select('COUNT(*)', 'total')
        .addSelect('COUNT(*) FILTER (WHERE b.delisted_at IS NULL)', 'available')
        .addSelect(
          'COUNT(*) FILTER (WHERE b.region_id IS NULL)',
          'without_region',
        )
        .addSelect(
          'COUNT(*) FILTER (WHERE c.code IS NULL)',
          'unknown_distillery',
        )
        .addSelect('MAX(b.last_seen_at)', 'last_seen_at')
        .getRawOne<CountsRow>(),
      this.runs.find({ order: { startedAt: 'DESC' }, take: 10 }),
    ]);
    // Aggregates without GROUP BY always yield exactly one row.
    if (!counts) throw new Error('No stats row');
    const total = Number(counts.total);
    const available = Number(counts.available);
    return {
      bottles: {
        total,
        available,
        delisted: total - available,
        without_region: Number(counts.without_region),
        unknown_distillery: Number(counts.unknown_distillery),
        last_seen_at: counts.last_seen_at
          ? new Date(counts.last_seen_at).toISOString()
          : null,
      },
      scraper: {
        running: this.sync.isRunning(),
        recent_runs: recent.map(toSmwsScrapeRunJson),
      },
    };
  }
}
