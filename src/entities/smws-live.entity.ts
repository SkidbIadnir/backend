import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('smws_live')
export class SmwsLive {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'fullcode', type: 'varchar', length: 100, unique: true })
  fullCode: string;

  @Column({ name: 'distillery_code', type: 'varchar', length: 10, nullable: true })
  distilleryCode: string | null;

  @Column({ name: 'cask_no', type: 'varchar', length: 50, nullable: true })
  caskNo: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  price: string | null;

  @Column({ type: 'text', nullable: true })
  profile: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  abv: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  age: string | null;

  @Column({ name: 'cask_type', type: 'varchar', length: 100, nullable: true })
  caskType: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  distillery: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  region: string | null;

  @Column({ type: 'boolean', default: true })
  available: boolean;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ name: 'is_new', type: 'boolean', default: false })
  isNew: boolean;

  @Column({ name: 'new_since', type: 'timestamp', nullable: true })
  newSince: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
