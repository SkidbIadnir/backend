import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasteepWishlistFolder } from '../entities/tasteep-wishlist-folder.entity';
import { UpsertWishlistFolderDto } from './dto/upsert-wishlist-folder.dto';
import {
  applyUpsertFolderDto,
  toFolderJson,
  WishlistFolderJson,
} from './wishlist.mapper';

@Injectable()
export class WishlistFoldersService {
  constructor(
    @InjectRepository(TasteepWishlistFolder)
    private readonly repo: Repository<TasteepWishlistFolder>,
  ) {}

  async list(userId: string): Promise<WishlistFolderJson[]> {
    const rows = await this.repo.find({
      where: { userId },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows.map(toFolderJson);
  }

  async get(userId: string, id: string): Promise<WishlistFolderJson> {
    return toFolderJson(await this.findOwned(userId, id));
  }

  /** Create-or-replace. The client owns the id. */
  async upsert(
    userId: string,
    id: string,
    dto: UpsertWishlistFolderDto,
  ): Promise<WishlistFolderJson> {
    const existing = await this.repo.findOne({ where: { id } });
    if (existing && existing.userId !== userId) {
      throw new ConflictException(
        'This id is already used by another account.',
      );
    }

    const target = existing ?? this.repo.create({ id, userId });
    applyUpsertFolderDto(target, dto);
    await this.repo.save(target);
    return toFolderJson(await this.findOwned(userId, id));
  }

  /** Its items are not deleted — `folder_id` falls back to null (Unfiled) via `onDelete: 'SET NULL'`. */
  async remove(userId: string, id: string): Promise<void> {
    const result = await this.repo.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException('Wishlist folder not found.');
    }
  }

  private async findOwned(
    userId: string,
    id: string,
  ): Promise<TasteepWishlistFolder> {
    const folder = await this.repo.findOne({ where: { id, userId } });
    if (!folder) {
      throw new NotFoundException('Wishlist folder not found.');
    }
    return folder;
  }
}
