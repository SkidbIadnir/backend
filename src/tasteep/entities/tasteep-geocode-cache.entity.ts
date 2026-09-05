import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { LocationPrecision } from './tasteep-tasting.entity';

/**
 * Nominatim results keyed on the normalised query. Misses are cached too
 * (`lat`/`lon` null, precision `unknown`) so the same unknown place is never
 * asked for twice — the policy is "never re-query".
 */
@Entity('tasteep_geocode_cache')
export class TasteepGeocodeCache {
  @PrimaryColumn({ type: 'text' })
  query: string;

  @Column({ type: 'double precision', nullable: true })
  lat: number | null;

  @Column({ type: 'double precision', nullable: true })
  lon: number | null;

  @Column({ type: 'text' })
  precision: LocationPrecision;

  @Column({ type: 'text', default: 'nominatim' })
  provider: string;

  @CreateDateColumn({ name: 'resolved_at', type: 'timestamptz' })
  resolvedAt: Date;
}
