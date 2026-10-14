import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { WISHLIST_CATEGORIES } from '../../entities/tasteep-wishlist-item.entity';
import type { WishlistCategory } from '../../entities/tasteep-wishlist-item.entity';

/**
 * Body of `PUT /tasteep/wishlist/items/:id`. Snake_case keys, everything but
 * `name` nullable. `id`, `created_at` and `updated_at` are ignored if sent
 * (the URL and the server own them).
 */
export class UpsertWishlistItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name: string;

  /** Id of a folder owned by the caller. `400` if it isn't. Absent/null → Unfiled. */
  @IsOptional()
  @IsUUID()
  folder_id?: string | null;

  @IsOptional()
  @IsString()
  distillery?: string | null;

  @IsOptional()
  @IsString()
  region?: string | null;

  /** Id from `GET /tasteep/regions` (e.g. `scotland/islay`). `400` if unknown. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  region_id?: string | null;

  @IsOptional()
  @IsIn(WISHLIST_CATEGORIES)
  category?: WishlistCategory | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  target_price?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  why_i_want?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  where_to_buy?: string | null;

  /** Id of a tasting owned by the caller, set once "Log a tasting" is completed. `400` if it isn't. */
  @IsOptional()
  @IsUUID()
  fulfilled_tasting_id?: string | null;
}
