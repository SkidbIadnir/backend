import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('smws_lookout')
export class SmwsLookout {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  distillery: string | null;
}
