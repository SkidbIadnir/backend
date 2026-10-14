import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TasteepWishlistItem } from '../entities/tasteep-wishlist-item.entity';
import { TasteepWishlistFolder } from '../entities/tasteep-wishlist-folder.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { UpsertWishlistItemDto } from './dto/upsert-wishlist-item.dto';
import { RegionsService } from '../regions/regions.service';
import { applyUpsertItemDto, toItemJson, WishlistItemJson } from './wishlist.mapper';

@Injectable()
export class WishlistItemsService {
  constructor(
    @InjectRepository(TasteepWishlistItem)
    private readonly repo: Repository<TasteepWishlistItem>,
    @InjectRepository(TasteepWishlistFolder)
    private readonly foldersRepo: Repository<TasteepWishlistFolder>,
    @InjectRepository(TasteepTasting)
    private readonly tastingsRepo: Repository<TasteepTasting>,
    private readonly regions: RegionsService,
  ) {}

  /** Newest first. `folderId` narrows to one folder, `unfiled` to none. */
  async list(
    userId: string,
    options: { folderId?: string; unfiled?: boolean } = {},
  ): Promise<WishlistItemJson[]> {
    const rows = await this.repo.find({
      where: {
        userId,
        ...(options.folderId ? { folderId: options.folderId } : {}),
        ...(options.unfiled ? { folderId: IsNull() } : {}),
      },
      order: { createdAt: 'DESC' },
    });
    return rows.map(toItemJson);
  }

  async get(userId: string, id: string): Promise<WishlistItemJson> {
    return toItemJson(await this.findOwned(userId, id));
  }

  /**
   * Create-or-replace. The client owns the id. `folder_id` and
   * `fulfilled_tasting_id` must reference a row owned by the same user —
   * unlike the region picker (shared curated data with no owner), folders
   * and tastings are per-user, so an unowned or unknown id is a `400`, not a
   * silent drop.
   *
   * Region resolution follows `TastingsService.upsert` exactly: `region_id`
   * wins and must exist; otherwise free-text `region` is matched by name.
   */
  async upsert(
    userId: string,
    id: string,
    dto: UpsertWishlistItemDto,
  ): Promise<WishlistItemJson> {
    const existing = await this.repo.findOne({ where: { id } });
    if (existing && existing.userId !== userId) {
      throw new ConflictException(
        'This id is already used by another account.',
      );
    }

    const target = existing ?? this.repo.create({ id, userId });
    applyUpsertItemDto(target, dto);

    if (dto.folder_id) {
      const folder = await this.foldersRepo.findOne({
        where: { id: dto.folder_id, userId },
      });
      if (!folder) {
        throw new BadRequestException(
          `Unknown or inaccessible folder_id "${dto.folder_id}".`,
        );
      }
      target.folderId = folder.id;
    } else {
      target.folderId = null;
    }

    const region = await this.regions.resolve(dto.region_id, dto.region);
    target.regionId = region?.id ?? null;
    if (region && !target.region) target.region = region.name;

    if (dto.fulfilled_tasting_id) {
      const tasting = await this.tastingsRepo.findOne({
        where: { id: dto.fulfilled_tasting_id, userId },
      });
      if (!tasting) {
        throw new BadRequestException(
          `Unknown or inaccessible fulfilled_tasting_id "${dto.fulfilled_tasting_id}".`,
        );
      }
      target.fulfilledTastingId = tasting.id;
    } else {
      target.fulfilledTastingId = null;
    }

    await this.repo.save(target);
    return toItemJson(await this.findOwned(userId, id));
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.repo.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException('Wishlist item not found.');
    }
  }

  private async findOwned(
    userId: string,
    id: string,
  ): Promise<TasteepWishlistItem> {
    const item = await this.repo.findOne({ where: { id, userId } });
    if (!item) {
      throw new NotFoundException('Wishlist item not found.');
    }
    return item;
  }
}
