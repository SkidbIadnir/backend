import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A pending 6-digit code sent to an email address. Only the HMAC of the code
 * is stored. A new request for the same address invalidates older rows.
 */
@Entity('tasteep_email_otps')
export class TasteepEmailOtp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('tasteep_email_otps_email_idx')
  @Column({ type: 'text' })
  email: string;

  @Column({ name: 'code_hash', type: 'text' })
  codeHash: string;

  @Column({ type: 'smallint', default: 0 })
  attempts: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
