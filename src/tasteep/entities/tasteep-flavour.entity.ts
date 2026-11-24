import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The flavour vocabulary that tasting tags are matched against, seeded from
 * `src/tasteep/data/flavours.json` at boot (see `FlavoursService.seed`).
 *
 * Two levels in one self-referencing table: a category (`smoky`) has
 * `parent_id = NULL`, a flavour (`smoky/peat`) points at its category. Both
 * are valid matches for a tag: "smoky" on its own resolves to the category.
 *
 * `id` is a stable slug of the English name, so the seed is idempotent across
 * environments and clients and stats can rely on it. Labels are per language;
 * the client shows the one matching its locale.
 *
 * A tag matches a row when, normalised (case, accents, spacing), it equals the
 * row's id, either name, or one of its `aliases`. See `flavour.rules.ts`.
 *
 * Edited from the admin dashboard. The boot seed inserts missing ids and adds
 * the file's aliases to existing rows; it never renames or deletes. Deletes
 * are soft (`deleted_at`): the row stops matching, and the next reindex drops
 * it from `tasteep_tastings.flavour_ids`.
 */
@Entity('tasteep_flavours')
@Index('tasteep_flavours_parent_idx', ['parentId'])
export class TasteepFlavour {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ name: 'name_en', type: 'text' })
  nameEn: string;

  @Column({ name: 'name_fr', type: 'text' })
  nameFr: string;

  @ManyToOne(() => TasteepFlavour, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: TasteepFlavour | null;

  @Column({ name: 'parent_id', type: 'text', nullable: true })
  parentId: string | null;

  /** Display order within the parent (seed order). */
  @Column({ name: 'sort_order', type: 'smallint', default: 0 })
  sortOrder: number;

  /** Other spellings, any language (`peaty`, `tourbé`). Stored as typed. */
  @Column({ type: 'text', array: true, default: '{}' })
  aliases: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
