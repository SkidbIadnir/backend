import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { LocationPrecision } from '../entities/tasteep-tasting.entity';
import { tasteepConfig } from '../tasteep-config';

export interface GeocodeHit {
  lat: number;
  lon: number;
  precision: Exclude<LocationPrecision, 'manual' | 'unknown'>;
}

interface NominatimResult {
  lat: string;
  lon: string;
  /** jsonv2: the OSM tag key that best describes the place (country, state, city, ...). */
  addresstype?: string;
  type?: string;
  class?: string;
}

const COUNTRY_TYPES = new Set(['country']);
const REGION_TYPES = new Set([
  'state',
  'region',
  'province',
  'county',
  'state_district',
  'district',
  'island',
  'archipelago',
]);

/** Maps what Nominatim matched on to the app's `location_precision` scale. */
export function precisionFromResult(
  result: Pick<NominatimResult, 'addresstype' | 'type'>,
): GeocodeHit['precision'] {
  const kind = (result.addresstype ?? result.type ?? '').toLowerCase();
  if (COUNTRY_TYPES.has(kind)) return 'country';
  if (REGION_TYPES.has(kind)) return 'region';
  return 'exact';
}

/** Thin Nominatim `/search` wrapper. Does *not* rate-limit — `GeocodeService` does. */
@Injectable()
export class NominatimClient {
  private readonly logger = new Logger(NominatimClient.name);

  constructor(private readonly httpService: HttpService) {}

  async search(query: string): Promise<GeocodeHit | null> {
    const userAgent = tasteepConfig.nominatimUserAgent;
    if (!userAgent) {
      throw new ServiceUnavailableException(
        'Geocoding is not configured: set TASTEEP_NOMINATIM_USER_AGENT to an identifying string.',
      );
    }

    const { data } = await firstValueFrom(
      this.httpService.get<NominatimResult[]>(
        `${tasteepConfig.nominatimBaseUrl}/search`,
        {
          params: { q: query, format: 'jsonv2', limit: 1, addressdetails: 0 },
          headers: { 'User-Agent': userAgent, Accept: 'application/json' },
          timeout: 10_000,
        },
      ),
    );

    const first = data?.[0];
    if (!first) return null;

    const lat = parseFloat(first.lat);
    const lon = parseFloat(first.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      this.logger.warn(
        `Nominatim returned non-numeric coordinates for "${query}"`,
      );
      return null;
    }
    return { lat, lon, precision: precisionFromResult(first) };
  }
}
