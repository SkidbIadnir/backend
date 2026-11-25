import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Body of `POST /admin/flavours`. The id is `slugify(name_en)` for a
 * category, or `${parent_id}/${slugify(name_en)}` for a flavour; `parent_id`
 * must be a live category (two levels).
 */
export class CreateFlavourDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_en: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_fr: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  parent_id?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  aliases?: string[];
}

/**
 * Body of `PATCH /admin/flavours/:id`. Absent keys are left unchanged; the id
 * never changes. A rename keeps the old name as an alias, so tags that
 * matched before still do.
 */
export class UpdateFlavourDto {
  // Not @IsOptional: that would let `null` through to a NOT NULL column.
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_en?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_fr?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(32767)
  sort_order?: number;

  /** Replaces the whole list. */
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  aliases?: string[];
}

/** Body of `POST /admin/flavours/:id/aliases`: map one more spelling (e.g. from the unmatched queue). */
export class AddFlavourAliasDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  alias: string;
}
