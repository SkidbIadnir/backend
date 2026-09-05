import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  LOCATION_PRECISIONS,
  TASTING_CATEGORIES,
} from '../../entities/tasteep-tasting.entity';
import type {
  LocationPrecision,
  TastingCategory,
} from '../../entities/tasteep-tasting.entity';

/**
 * Body of `PUT /tasteep/tastings/:id`. Mirrors `lib/models/tasting.dart`
 * `toJson()` exactly: snake_case keys, ISO 8601 dates, everything but `name`
 * nullable. `id`, `created_at` and `updated_at` are ignored if sent (the URL
 * and the server own them).
 */
export class UpsertTastingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name: string;

  @IsOptional()
  @IsIn(TASTING_CATEGORIES)
  category?: TastingCategory | null;

  @IsOptional()
  @IsString()
  photo_path?: string | null;

  @IsOptional()
  @IsString()
  distillery?: string | null;

  @IsOptional()
  @IsString()
  region?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  abv?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number | null;

  @IsOptional()
  @IsString()
  age_statement?: string | null;

  @IsOptional()
  @IsString()
  cask_type?: string | null;

  @IsOptional()
  @IsISO8601()
  date_tasted?: string | null;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number | null;

  @IsOptional()
  @IsString()
  appearance?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[] | null;

  @IsOptional()
  @IsString()
  nose?: string | null;

  @IsOptional()
  @IsString()
  palate?: string | null;

  @IsOptional()
  @IsString()
  finish?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon?: number | null;

  @IsOptional()
  @IsIn(LOCATION_PRECISIONS)
  location_precision?: LocationPrecision | null;
}
