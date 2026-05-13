import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('smws_distilleries')
@Unique(['smwsId', 'category'])
export class SmwsDistillery {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'smws_id', type: 'varchar', length: 10 })
  smwsId: string;

  @Column({ name: 'distillery_name', type: 'varchar', length: 255 })
  distilleryName: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  region: string | null;

  @Column({ type: 'varchar', length: 50 })
  category: string;

  @Column({ name: 'extra_info', type: 'text', nullable: true })
  extraInfo: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
