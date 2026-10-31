import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

/**
 * Curated list of spirit-producing regions the app offers as a picker, seeded
 * from `src/tasteep/data/region.json` at boot (see `RegionsService.seed`).
 *
 * One self-referencing table: a country is a row with `parent_id = NULL`, a
 * subregion is a row whose `parent_id` points at its country. Any row is a
 * valid choice for a tasting — "Scotland" on its own is fine when the
 * subregion is unknown.
 *
 * `id` is a stable slug (`scotland`, `scotland/speyside`) rather than a
 * generated key so the seed is idempotent across environments and the client
 * can rely on it.
 *
 * `lat`/`lon` are an approximate centroid: the Atlas uses them as a fallback
 * pin for tastings whose own location could not be resolved.
 *
 * Edited from the admin dashboard; the boot seed only inserts missing ids.
 * Deletes are soft (`deleted_at`): the row leaves the picker and free-text
 * matching, but tastings and SMWS codes keep pointing at it.
 */
@Entity('tasteep_regions')
@Index('tasteep_regions_parent_idx', ['parentId'])
export class TasteepRegion {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  name: string;

  @ManyToOne(() => TasteepRegion, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: TasteepRegion | null;

  @Column({ name: 'parent_id', type: 'text', nullable: true })
  parentId: string | null;

  @Column({ type: 'double precision', nullable: true })
  lat: number | null;

  @Column({ type: 'double precision', nullable: true })
  lon: number | null;

  /** Display order within the parent (seed order). */
  @Column({ name: 'sort_order', type: 'smallint', default: 0 })
  sortOrder: number;

  /**
   * Other spellings `RegionsService.resolve` matches (`Highlands`, `USA`).
   * `NULL` means never set: the boot seed fills those from `region.json`, so
   * an empty list set from the dashboard stays empty.
   */
  @Column({ type: 'text', array: true, nullable: true })
  aliases: string[] | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
