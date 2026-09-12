import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { LocationPrecision } from './tasteep-tasting.entity';

/**
 * Hand-curated distillery coordinates, seeded from
 * `src/tasteep/data/distillery-location.json` at boot (see
 * `DistilleryLocationsService.seed`) and — once the admin dashboard ships —
 * editable there directly. Checked before Nominatim in `GeocodeService` for
 * names Nominatim resolves ambiguously, wrongly, or not at all (see
 * `DistilleryLocationsService.match`).
 *
 * `id` is a stable slug (`ardbeg`) rather than a generated key so the seed
 * is idempotent across environments, matching `TasteepRegion`.
 */
@Entity('tasteep_distillery_locations')
export class TasteepDistilleryLocation {
  @PrimaryColumn({ type: 'text' })
  id: string;

  /** Canonical display name, e.g. "Ardbeg". */
  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'double precision' })
  lat: number;

  @Column({ type: 'double precision' })
  lon: number;

  @Column({ type: 'text' })
  precision: Exclude<LocationPrecision, 'manual' | 'unknown'>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
