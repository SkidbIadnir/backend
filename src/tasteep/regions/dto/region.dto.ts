import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Body of `POST /admin/regions`. The id is `slugify(name)` for a country, or
 * `${parent_id}/${slugify(name)}` for a subregion; `parent_id` must be a live
 * country (the picker has two levels).
 */
export class CreateRegionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  parent_id?: string | null;

  @IsOptional()
  @IsNumber()
  @IsLatitude()
  lat?: number | null;

  @IsOptional()
  @IsNumber()
  @IsLongitude()
  lon?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  aliases?: string[];
}

/**
 * Body of `PATCH /admin/regions/:id`. Absent keys are left unchanged; the id
 * never changes. A rename adds the old name to `aliases`, so text that
 * matched before still links.
 */
export class UpdateRegionDto {
  // Not @IsOptional: that would let `null` through to a NOT NULL column.
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsNumber()
  @IsLatitude()
  lat?: number | null;

  @IsOptional()
  @IsNumber()
  @IsLongitude()
  lon?: number | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(32767)
  sort_order?: number;

  /** Replaces the whole list. */
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  aliases?: string[];
}

/** Body of `POST /admin/regions/reorder`: the full list of live siblings, in their new order. */
export class ReorderRegionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  parent_id?: string | null;

  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  ids: string[];
}
