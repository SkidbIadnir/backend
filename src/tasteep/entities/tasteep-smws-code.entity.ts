import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TasteepRegion } from './tasteep-region.entity';

/**
 * SMWS cask codes → distillery, the reference list the app caches for offline
 * use. Seeded from `src/tasteep/data/smws-codes.json` at boot, inserting only
 * codes the table does not have yet, so edits made from the admin dashboard
 * survive restarts (see `SmwsCodesService.seed`). `GET /admin/smws-codes/diff`
 * reports where the table and the file disagree.
 *
 * Deletes are soft (`deleted_at`): a deleted code stays in the table so the
 * seed does not bring it back on the next boot.
 */
@Entity('tasteep_smws_codes')
export class TasteepSmwsCode {
  /** The SMWS code prefix: `1`, `G1`, `RW1`… Unique across all categories. */
  @PrimaryColumn({ type: 'text' })
  code: string;

  @Column({ name: 'distillery_name', type: 'text' })
  distilleryName: string;

  /** The seed file's category key, as is: `single malt`, `grain whisky`, `rum`… */
  @Column({ type: 'text' })
  category: string;

  /** Region text as SMWS gives it, e.g. `Speyside`, `Kentucky, USA`. */
  @Column({ type: 'text', nullable: true })
  region: string | null;

  /** Optional link to the curated picker, resolved from `region` when not set explicitly. */
  @ManyToOne(() => TasteepRegion, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'region_id' })
  regionRef: TasteepRegion | null;

  @Column({ name: 'region_id', type: 'text', nullable: true })
  regionId: string | null;

  /** Free-text note: former name, `Closed`, `Includes Ledaig (peated)`… */
  @Column({ type: 'text', nullable: true })
  extra: string | null;

  /** Position in the seed file; new codes go last. Orders the snapshot and the export. */
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
