import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('user_alerts')
@Unique(['userId', 'guildId', 'alertType', 'alertValue'])
export class UserAlert {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', length: 100 })
  userId: string;

  @Column({ name: 'guild_id', length: 100 })
  guildId: string;

  @Column({ name: 'alert_type', length: 50 })
  alertType: string;

  @Column({ name: 'alert_value', length: 255 })
  alertValue: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
