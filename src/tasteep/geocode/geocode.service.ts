import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasteepGeocodeCache } from '../entities/tasteep-geocode-cache.entity';
import { LocationPrecision } from '../entities/tasteep-tasting.entity';
import { NominatimClient } from './nominatim.client';
import { SerialRateLimiter } from './rate-limiter';

export interface GeocodeResult {
  lat: number;
  lon: number;
  precision: LocationPrecision;
}

/** Nominatim usage policy: max 1 request per second, server-wide. */
export const NOMINATIM_MIN_INTERVAL_MS = 1000;

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Cache-first geocoding. Every query hits `tasteep_geocode_cache` before
 * Nominatim, misses are cached as `unknown` so they are never retried, and
 * identical in-flight queries share one upstream request.
 */
@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);
  private readonly inFlight = new Map<string, Promise<GeocodeResult>>();

  constructor(
    @InjectRepository(TasteepGeocodeCache)
    private readonly cacheRepo: Repository<TasteepGeocodeCache>,
    private readonly nominatim: NominatimClient,
    private readonly limiter: SerialRateLimiter = new SerialRateLimiter(
      NOMINATIM_MIN_INTERVAL_MS,
    ),
  ) {}

  async resolve(rawQuery: string): Promise<GeocodeResult> {
    const query = normalizeQuery(rawQuery ?? '');
    if (!query) {
      throw new BadRequestException('query must not be empty.');
    }

    const cached = await this.cacheRepo.findOne({ where: { query } });
    if (cached) {
      return this.toResult(cached, query);
    }

    const pending = this.inFlight.get(query);
    if (pending) return pending;

    const job = this.lookupAndStore(query).finally(() =>
      this.inFlight.delete(query),
    );
    this.inFlight.set(query, job);
    return job;
  }

  private async lookupAndStore(query: string): Promise<GeocodeResult> {
    const hit = await this.limiter.schedule(() => this.nominatim.search(query));

    const row = this.cacheRepo.create({
      query,
      lat: hit?.lat ?? null,
      lon: hit?.lon ?? null,
      precision: hit?.precision ?? 'unknown',
      provider: 'nominatim',
    });
    await this.cacheRepo.save(row);
    this.logger.log(
      `Geocoded "${query}" → ${hit ? `${hit.precision} (${hit.lat}, ${hit.lon})` : 'no result'}`,
    );

    return this.toResult(row, query);
  }

  private toResult(row: TasteepGeocodeCache, query: string): GeocodeResult {
    if (row.lat == null || row.lon == null || row.precision === 'unknown') {
      throw new NotFoundException(`No location found for "${query}".`);
    }
    return { lat: row.lat, lon: row.lon, precision: row.precision };
  }
}
