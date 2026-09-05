import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TasteepUser } from './tasteep-user.entity';

/**
 * One row per issued bearer token. The JWT carries the session id (`sid`);
 * the guard checks the row is neither revoked nor expired on every request,
 * which is what makes `POST /auth/signout` actually invalidate a token.
 */
@Entity('tasteep_sessions')
export class TasteepSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TasteepUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: TasteepUser;

  @Index('tasteep_sessions_user_idx')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;
}
