import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export const AUTH_PROVIDERS = ['email', 'google', 'discord'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/**
 * A Tasteep account. One row per (provider, provider_id); email is unique
 * across providers so a Google and an email login for the same address
 * resolve to the same account.
 */
@Entity('tasteep_users')
@Unique('tasteep_users_provider_uq', ['provider', 'providerId'])
export class TasteepUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('tasteep_users_email_uq', { unique: true, where: 'email IS NOT NULL' })
  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ name: 'display_name', type: 'text' })
  displayName: string;

  @Column({ type: 'text' })
  provider: AuthProvider;

  @Column({ name: 'provider_id', type: 'text' })
  providerId: string;

  // Settings mirror the client's local SharedPreferences keys. No endpoint
  // syncs them yet; they exist so the columns are there when wanted.
  @Column({ name: 'theme_mode', type: 'text', default: 'light' })
  themeMode: string;

  @Column({ name: 'score_scale', type: 'text', default: 'hundred' })
  scoreScale: string;

  @Column({ name: 'unit_system', type: 'text', default: 'metric' })
  unitSystem: string;

  @Column({ type: 'text', default: '£' })
  currency: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
