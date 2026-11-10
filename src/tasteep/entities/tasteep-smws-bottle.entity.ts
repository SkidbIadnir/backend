import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TasteepRegion } from './tasteep-region.entity';
import { TasteepSmwsCode } from './tasteep-smws-code.entity';

/** Postgres returns `numeric` as a string; the client wants a JSON number. */
const numericTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) =>
    value === null || value === undefined ? null : parseFloat(value),
};

export const SMWS_BOTTLE_KINDS = ['single_cask', 'blend', 'other'] as const;
/**
 * - `single_cask` — one SMWS cask code (`1.309`, `RW6.5`)
 * - `blend` — a whisky without a single cask code: small batches, blended
 *   malts, `SM` codes (`Batch 40`, `Distillery 68 Rare Release`)
 * - `other` — anything else with an ABV: tasting packs, gift sets, two-cask
 *   duos, gin, rum, beer
 */
export type SmwsBottleKind = (typeof SMWS_BOTTLE_KINDS)[number];

/**
 * One SMWS bottle sold on smws.eu, kept for good: a bottle that sells out
 * stays with `in_stock = false`, so the out-of-stock rows are our archive.
 *
 * Identity is the shop's SKU, which every product has (blends have no cask
 * code). Filled by `SmwsBottleSyncService` from plain-HTTP reads of each
 * product page: availability comes from the page's own stock flag, and a
 * read that lacks a field never erases a value already stored.
 *
 * Table `tasteep_smws_catalog` (the Playwright-era `tasteep_smws_bottles`
 * is left in place for comparison until it is dropped).
 */
@Entity('tasteep_smws_catalog')
@Index('tasteep_smws_catalog_code_key', ['code'], {
  unique: true,
  where: '"code" IS NOT NULL',
})
@Index('tasteep_smws_catalog_url_idx', ['url'])
@Index('tasteep_smws_catalog_distillery_code_idx', ['distilleryCode'])
@Index('tasteep_smws_catalog_region_idx', ['regionId'])
@Index('tasteep_smws_catalog_in_stock_idx', ['inStock'])
export class TasteepSmwsBottle {
  @PrimaryColumn({ type: 'text' })
  sku: string;

  /** The shop's product id. */
  @Column({ name: 'product_id', type: 'integer', nullable: true })
  productId: number | null;

  /** Normalized product URL (absolute, no query, no trailing slash). */
  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'text' })
  kind: SmwsBottleKind;

  /** Full SMWS cask code (`1.309`, `RW6.5`); `null` for blends. */
  @Column({ type: 'text', nullable: true })
  code: string | null;

  /** Code prefix (`1`, `RW6`), the key of `tasteep_smws_codes`; `null` for blends. */
  @Column({ name: 'distillery_code', type: 'text', nullable: true })
  distilleryCode: string | null;

  /**
   * The distillery behind the code. No FK constraint: SMWS can list a code
   * the reference list does not have yet, and the bottle must still be saved.
   */
  @ManyToOne(() => TasteepSmwsCode, {
    nullable: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'distillery_code', referencedColumnName: 'code' })
  smwsCode: TasteepSmwsCode | null;

  /** Part after the dot of the code. */
  @Column({ name: 'cask_no', type: 'text', nullable: true })
  caskNo: string | null;

  /** Blend batch as displayed, e.g. `Batch 40`. */
  @Column({ type: 'text', nullable: true })
  batch: string | null;

  @Column({ type: 'text' })
  name: string;

  /** Price exactly as displayed, e.g. `€140.00`. */
  @Column({ name: 'price_text', type: 'text', nullable: true })
  priceText: string | null;

  @Column({
    name: 'price_amount',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  priceAmount: number | null;

  /** ISO 4217, e.g. `EUR`. */
  @Column({ name: 'price_currency', type: 'text', nullable: true })
  priceCurrency: string | null;

  /** Percent, e.g. `58.3`. */
  @Column({
    type: 'numeric',
    precision: 4,
    scale: 1,
    nullable: true,
    transformer: numericTransformer,
  })
  abv: number | null;

  /** As displayed, e.g. `14 years`. */
  @Column({ type: 'text', nullable: true })
  age: string | null;

  @Column({ name: 'cask_type', type: 'text', nullable: true })
  caskType: string | null;

  /** `YYYY-MM-DD` (Postgres `date`, returned as a string). */
  @Column({ name: 'distilled_date', type: 'date', nullable: true })
  distilledDate: string | null;

  /** SMWS flavour profile, e.g. `Dried Fruits & Spices`. */
  @Column({ type: 'text', nullable: true })
  profile: string | null;

  /** Region text as SMWS gives it on the bottle page. */
  @Column({ name: 'region_text', type: 'text', nullable: true })
  regionText: string | null;

  /**
   * Curated region or subregion: `region_text` resolved through
   * `RegionsService.resolve`, falling back to the distillery code's region.
   */
  @ManyToOne(() => TasteepRegion, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'region_id' })
  regionRef: TasteepRegion | null;

  @Column({ name: 'region_id', type: 'text', nullable: true })
  regionId: string | null;

  /** The shop's category paths, as given (`All Whisky/Cask Type/Sherry Casks`…). */
  @Column({ type: 'text', array: true, default: '{}' })
  categories: string[];

  /** The shop's `Release Date`, read as UTC (the shop gives no time zone). */
  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  /** From the page's own stock flag at the last successful read. */
  @Column({ name: 'in_stock', type: 'boolean' })
  inStock: boolean;

  /** Units left at the last read, when the shop shows it. */
  @Column({ type: 'integer', nullable: true })
  stock: number | null;

  @Column({ name: 'first_seen_at', type: 'timestamptz' })
  firstSeenAt: Date;

  /** Last successful read of the page. */
  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  /** When we saw it go out of stock; `null` if in stock or never seen in stock. */
  @Column({ name: 'delisted_at', type: 'timestamptz', nullable: true })
  delistedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
