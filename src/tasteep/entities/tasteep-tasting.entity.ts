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

export const TASTING_CATEGORIES = ['whisky', 'rum', 'agave', 'other'] as const;
export type TastingCategory = (typeof TASTING_CATEGORIES)[number];

export const LOCATION_PRECISIONS = [
  'exact',
  'region',
  'country',
  'manual',
  'unknown',
] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

/** Precisions that the "NOT PLACED" shelf should show. */
export const UNPLACED_PRECISIONS: LocationPrecision[] = ['unknown', 'country'];

/** Postgres returns `numeric` as a string; the client wants a JSON number. */
const numericTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) =>
    value === null || value === undefined ? null : parseFloat(value),
};

/**
 * One journal entry. The client generates the id (UUID) and always PUTs, so
 * the primary key is *not* server-generated.
 */
@Entity('tasteep_tastings')
@Index('tasteep_tastings_user_date_idx', ['userId', 'dateTasted'])
@Index('tasteep_tastings_user_category_idx', ['userId', 'category'])
@Check(
  'tasteep_tastings_category_chk',
  `category IN ('whisky', 'rum', 'agave', 'other')`,
)
@Check(
  'tasteep_tastings_precision_chk',
  `location_precision IN ('exact', 'region', 'country', 'manual', 'unknown')`,
)
@Check('tasteep_tastings_score_chk', `score IS NULL OR score BETWEEN 0 AND 100`)
export class TasteepTasting {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @ManyToOne(() => TasteepUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: TasteepUser;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', default: 'whisky' })
  category: TastingCategory;

  /**
   * Photos stay on the user's device for now, so this is an opaque
   * client-side path that is stored and echoed back verbatim.
   */
  @Column({ name: 'photo_path', type: 'text', nullable: true })
  photoPath: string | null;

  @Column({ type: 'text', nullable: true })
  distillery: string | null;

  @Column({ type: 'text', nullable: true })
  region: string | null;

  @Column({ type: 'numeric', nullable: true, transformer: numericTransformer })
  abv: number | null;

  @Column({ type: 'numeric', nullable: true, transformer: numericTransformer })
  price: number | null;

  @Column({ name: 'age_statement', type: 'text', nullable: true })
  ageStatement: string | null;

  @Column({ name: 'cask_type', type: 'text', nullable: true })
  caskType: string | null;

  @Column({ name: 'date_tasted', type: 'timestamptz', nullable: true })
  dateTasted: Date | null;

  @Column({ type: 'text', nullable: true })
  location: string | null;

  @Column({ type: 'smallint', nullable: true })
  score: number | null;

  @Column({ type: 'text', nullable: true })
  appearance: string | null;

  @Column({ type: 'text', array: true, default: '{}' })
  tags: string[];

  @Column({ type: 'text', nullable: true })
  nose: string | null;

  @Column({ type: 'text', nullable: true })
  palate: string | null;

  @Column({ type: 'text', nullable: true })
  finish: string | null;

  @Column({ type: 'double precision', nullable: true })
  lat: number | null;

  @Column({ type: 'double precision', nullable: true })
  lon: number | null;

  @Column({ name: 'location_precision', type: 'text', default: 'unknown' })
  locationPrecision: LocationPrecision;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
