import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Body of `PUT /tasteep/wishlist/folders/:id`. `id`, `created_at` and
 * `updated_at` are ignored if sent (the URL and the server own them).
 */
export class UpsertWishlistFolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(32767)
  sort_order?: number | null;
}
