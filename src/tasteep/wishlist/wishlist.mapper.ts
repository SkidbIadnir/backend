import { TasteepWishlistFolder } from '../entities/tasteep-wishlist-folder.entity';
import { TasteepWishlistItem } from '../entities/tasteep-wishlist-item.entity';
import { UpsertWishlistFolderDto } from './dto/upsert-wishlist-folder.dto';
import { UpsertWishlistItemDto } from './dto/upsert-wishlist-item.dto';

export interface WishlistFolderJson {
  id: string;
  name: string;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface WishlistItemJson {
  id: string;
  folder_id: string | null;
  name: string;
  distillery: string | null;
  region: string | null;
  region_id: string | null;
  category: TasteepWishlistItem['category'];
  target_price: number | null;
  why_i_want: string | null;
  where_to_buy: string | null;
  fulfilled_tasting_id: string | null;
  fulfilled: boolean;
  created_at: string | null;
  updated_at: string | null;
}

const iso = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

export function toFolderJson(f: TasteepWishlistFolder): WishlistFolderJson {
  return {
    id: f.id,
    name: f.name,
    sort_order: f.sortOrder ?? 0,
    created_at: iso(f.createdAt),
    updated_at: iso(f.updatedAt),
  };
}

/** Full-replacement semantics: an absent key becomes null on the row (PUT, not PATCH). */
export function applyUpsertFolderDto(
  target: TasteepWishlistFolder,
  dto: UpsertWishlistFolderDto,
): TasteepWishlistFolder {
  target.name = dto.name;
  target.sortOrder = dto.sort_order ?? 0;
  return target;
}

export function toItemJson(i: TasteepWishlistItem): WishlistItemJson {
  return {
    id: i.id,
    folder_id: i.folderId ?? null,
    name: i.name,
    distillery: i.distillery ?? null,
    region: i.region ?? null,
    region_id: i.regionId ?? null,
    category: i.category ?? null,
    target_price: i.targetPrice ?? null,
    why_i_want: i.whyIWant ?? null,
    where_to_buy: i.whereToBuy ?? null,
    fulfilled_tasting_id: i.fulfilledTastingId ?? null,
    fulfilled: i.fulfilledTastingId != null,
    created_at: iso(i.createdAt),
    updated_at: iso(i.updatedAt),
  };
}

/**
 * Full-replacement semantics, mirroring `applyUpsertDto` in
 * `tasting.mapper.ts`. `folder_id` and `fulfilled_tasting_id` are set here
 * to the raw body value; the service then overwrites both with an
 * ownership-checked value (or null) after validating them, the same way it
 * overwrites `region_id` after resolving it.
 */
export function applyUpsertItemDto(
  target: TasteepWishlistItem,
  dto: UpsertWishlistItemDto,
): TasteepWishlistItem {
  target.name = dto.name;
  target.folderId = dto.folder_id ?? null;
  target.distillery = dto.distillery ?? null;
  target.region = dto.region ?? null;
  target.regionId = dto.region_id ?? null;
  target.category = dto.category ?? null;
  target.targetPrice = dto.target_price ?? null;
  target.whyIWant = dto.why_i_want ?? null;
  target.whereToBuy = dto.where_to_buy ?? null;
  target.fulfilledTastingId = dto.fulfilled_tasting_id ?? null;
  return target;
}
