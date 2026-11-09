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

/**
 * One SMWS bottling as seen on smws.eu, kept for good: a bottle that leaves
 * the shop is flagged (`delisted_at`), never deleted, so the rows where
 * `delisted_at IS NOT NULL` are our own archive.
 *
 * Identity is the full SMWS code (`1.234`). The listing pages only give a
 * product URL, so the scraper matches listed bottles on the normalized `url`
 * and reads the code from the detail page the first time it sees that URL.
 *
 * Availability is decided by `SmwsBottleSyncService` (see `planSync`), never
 * by a single scrape: a bottle is delisted only after missing several
 * trusted runs in a row.
 */
@Entity('tasteep_smws_bottles')
@Index('tasteep_smws_bottles_url_idx', ['url'])
@Index('tasteep_smws_bottles_distillery_code_idx', ['distilleryCode'])
@Index('tasteep_smws_bottles_region_idx', ['regionId'])
@Index('tasteep_smws_bottles_delisted_at_idx', ['delistedAt'])
export class TasteepSmwsBottle {
  /** Full SMWS code, e.g. `1.234`, `G1.12`. */
  @PrimaryColumn({ type: 'text' })
  code: string;

  /** Code prefix (`1`, `G1`), the key of `tasteep_smws_codes`. */
  @Column({ name: 'distillery_code', type: 'text' })
  distilleryCode: string;

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

  /** Part after the dot. */
  @Column({ name: 'cask_no', type: 'text' })
  caskNo: string;

  @Column({ type: 'text' })
  name: string;

  /** Normalized product URL (absolute, no query, no trailing slash). */
  @Column({ type: 'text' })
  url: string;

  /** Price exactly as displayed, e.g. `€95.00`. */
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

  /** ISO 4217 (`EUR`, `GBP`) when the symbol was recognized. */
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

  @Column({ type: 'text', nullable: true })
  age: string | null;

  @Column({ name: 'cask_type', type: 'text', nullable: true })
  caskType: string | null;

  /** SMWS flavour profile, e.g. `Juicy, oak & vanilla`. */
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

  @Column({ name: 'first_seen_at', type: 'timestamptz' })
  firstSeenAt: Date;

  /** Last trusted or untrusted run that listed it. */
  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  /** Set once the bottle missed enough trusted runs in a row; cleared if it comes back. */
  @Column({ name: 'delisted_at', type: 'timestamptz', nullable: true })
  delistedAt: Date | null;

  /** Trusted runs in a row that did not list it. Reset to 0 whenever it is listed. */
  @Column({ name: 'consecutive_misses', type: 'smallint', default: 0 })
  consecutiveMisses: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
