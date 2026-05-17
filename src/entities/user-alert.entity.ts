import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('user_alerts')
@Unique(['userId', 'alertType', 'alertValue'])
export class UserAlert {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', length: 100 })
  userId: string;

  @Column({ name: 'guild_id', type: 'varchar', length: 100, nullable: true })
  guildId: string | null;

  @Column({ name: 'alert_type', length: 50 })
  alertType: string;

  @Column({ name: 'alert_value', length: 255 })
  alertValue: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
