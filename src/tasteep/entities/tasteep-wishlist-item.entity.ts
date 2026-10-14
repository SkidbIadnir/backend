import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TasteepUser } from './tasteep-user.entity';
import { TasteepRegion } from './tasteep-region.entity';
import { TasteepTasting } from './tasteep-tasting.entity';
import { TasteepWishlistFolder } from './tasteep-wishlist-folder.entity';

/**
 * Its own, wider category set than `TASTING_CATEGORIES` — wishlist bottles
 * span gin and cognac, which the journal's 4-value enum can't label.
 */
export const WISHLIST_CATEGORIES = [
  'whisky',
  'rum',
  'agave',
  'gin',
  'cognac',
  'other',
] as const;
export type WishlistCategory = (typeof WISHLIST_CATEGORIES)[number];

/** Postgres returns `numeric` as a string; the client wants a JSON number. */
const numericTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) =>
    value === null || value === undefined ? null : parseFloat(value),
};

/**
 * A bottle the user wants to buy. The client generates the id (UUID) and
 * always PUTs, so the primary key is *not* server-generated.
 */
@Entity('tasteep_wishlist_items')
@Index('tasteep_wishlist_items_user_folder_idx', ['userId', 'folderId'])
@Check(
  'tasteep_wishlist_items_category_chk',
  `category IS NULL OR category IN ('whisky', 'rum', 'agave', 'gin', 'cognac', 'other')`,
)
export class TasteepWishlistItem {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @ManyToOne(() => TasteepUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: TasteepUser;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Null means "Unfiled". Deleting the folder unfiles its items (`SET NULL`), never deletes them. */
  @ManyToOne(() => TasteepWishlistFolder, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'folder_id' })
  folder: TasteepWishlistFolder | null;

  @Column({ name: 'folder_id', type: 'uuid', nullable: true })
  folderId: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  distillery: string | null;

  /** Free text, always kept verbatim — the user may type anything here. */
  @Column({ type: 'text', nullable: true })
  region: string | null;

  /** Optional link to the curated picker (`tasteep_regions`), same as `TasteepTasting.regionRef`. */
  @ManyToOne(() => TasteepRegion, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'region_id' })
  regionRef: TasteepRegion | null;

  @Column({ name: 'region_id', type: 'text', nullable: true })
  regionId: string | null;

  @Column({ type: 'text', nullable: true })
  category: WishlistCategory | null;

  @Column({
    name: 'target_price',
    type: 'numeric',
    nullable: true,
    transformer: numericTransformer,
  })
  targetPrice: number | null;

  @Column({ name: 'why_i_want', type: 'text', nullable: true })
  whyIWant: string | null;

  @Column({ name: 'where_to_buy', type: 'text', nullable: true })
  whereToBuy: string | null;

  /**
   * Set once the user logs a real tasting for this wish, via "Log a
   * tasting". "Wanted" vs "fulfilled" in the API response is derived from
   * whether this is null — there is no separate stored status column.
   */
  @ManyToOne(() => TasteepTasting, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'fulfilled_tasting_id' })
  fulfilledTasting: TasteepTasting | null;

  @Column({ name: 'fulfilled_tasting_id', type: 'uuid', nullable: true })
  fulfilledTastingId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
