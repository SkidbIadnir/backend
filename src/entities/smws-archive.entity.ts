import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('smws_archive')
export class SmwsArchive {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  price: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

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

  @Column({ name: 'bottle_size', type: 'varchar', length: 50, nullable: true })
  bottleSize: string | null;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ name: 'is_new', type: 'boolean', default: false })
  isNew: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
