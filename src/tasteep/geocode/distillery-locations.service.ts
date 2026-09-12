import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasteepDistilleryLocation } from '../entities/tasteep-distillery-location.entity';
import { slugify } from '../regions/regions.service';
import { normalizeQuery } from './normalize-query';
import * as distilleryData from '../data/distillery-location.json';

/** Shape of `src/tasteep/data/distillery-location.json`. */
export interface DistillerySeedFile {
  distilleries: {
    name: string;
    lat: number;
    lon: number;
    precision: 'exact' | 'region' | 'country';
  }[];
}

/** Builds the rows the seed file describes, keyed on a stable slug id. */
export function seedRows(
  file: DistillerySeedFile,
): Partial<TasteepDistilleryLocation>[] {
  return file.distilleries.map((d) => ({
    id: slugify(d.name),
    name: d.name,
    lat: d.lat,
    lon: d.lon,
    precision: d.precision,
  }));
}

/**
 * Hand-curated distillery coordinates, checked before Nominatim in
 * `GeocodeService` for names Nominatim resolves ambiguously, wrongly, or not
 * at all. Seeds `tasteep_distillery_locations` from
 * `distillery-location.json` at boot (upsert by slug — rows are never
 * deleted automatically, so removing an entry from the file leaves the row
 * intact) and, once the admin dashboard ships, will be editable there
 * directly instead of through the seed file.
 */
@Injectable()
export class DistilleryLocationsService implements OnModuleInit {
  private readonly logger = new Logger(DistilleryLocationsService.name);

  constructor(
    @InjectRepository(TasteepDistilleryLocation)
    private readonly repo: Repository<TasteepDistilleryLocation>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  async seed(
    file: DistillerySeedFile = distilleryData as DistillerySeedFile,
  ): Promise<number> {
    const rows = seedRows(file);
    if (rows.length) await this.repo.upsert(rows, ['id']);
    this.logger.log(`Seeded ${rows.length} distillery location(s).`);
    return rows.length;
  }

  /**
   * Matches a normalized geocode query (see `normalizeQuery`) against the
   * curated table. Matches when the query equals a distillery's normalized
   * name exactly, or starts with the name followed by any non-alphanumeric
   * separator (space, comma, "·", ...) — so "ardbeg · islay" and
   * "ardbeg, islay" both match "ardbeg", while "ardbegxyz" correctly
   * doesn't.
   */
  async match(
    normalizedQuery: string,
  ): Promise<TasteepDistilleryLocation | null> {
    const rows = await this.repo.find();
    for (const row of rows) {
      const name = normalizeQuery(row.name);
      if (normalizedQuery === name) return row;
      if (
        normalizedQuery.startsWith(name) &&
        !/[a-z0-9]/i.test(normalizedQuery[name.length] ?? '')
      ) {
        return row;
      }
    }
    return null;
  }
}
