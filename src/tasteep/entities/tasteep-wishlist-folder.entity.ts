import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TasteepUser } from './tasteep-user.entity';

/**
 * A flat (non-nested) folder a user files wishlist items into, e.g. "Next
 * Purchase" or "Someday". The client generates the id (UUID) and always
 * PUTs, so the primary key is *not* server-generated.
 */
@Entity('tasteep_wishlist_folders')
@Index('tasteep_wishlist_folders_user_idx', ['userId'])
export class TasteepWishlistFolder {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @ManyToOne(() => TasteepUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: TasteepUser;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'sort_order', type: 'smallint', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
