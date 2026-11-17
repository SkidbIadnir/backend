import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TasteepUser } from './tasteep-user.entity';

export const FEEDBACK_TYPES = ['bug', 'idea', 'other'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** Triage state, set from the dashboard only. Users never see it. */
export const FEEDBACK_STATUSES = ['new', 'reviewed', 'archived'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/**
 * A free-form message a signed-in user sent from the app. Write-only from the
 * user's side; read and triaged through `/admin/feedback`.
 */
@Entity('tasteep_feedback')
@Index('tasteep_feedback_user_idx', ['userId'])
@Index('tasteep_feedback_status_created_idx', ['status', 'createdAt'])
export class TasteepFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TasteepUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: TasteepUser;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  type: FeedbackType;

  @Column({ type: 'text' })
  message: string;

  @Column({ name: 'app_version', type: 'text', nullable: true })
  appVersion: string | null;

  @Column({ type: 'text', nullable: true })
  platform: string | null;

  @Column({ type: 'text', default: 'new' })
  status: FeedbackStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
