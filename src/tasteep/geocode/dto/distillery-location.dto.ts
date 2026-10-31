import {
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { TasteepDistilleryLocation } from '../../entities/tasteep-distillery-location.entity';

export const CURATED_PRECISIONS = ['exact', 'region', 'country'] as const;
export type CuratedPrecision = TasteepDistilleryLocation['precision'];

/** Body of `POST /admin/distillery-locations`. The id is `slugify(name)`. */
export class CreateDistilleryLocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsNumber()
  @IsLatitude()
  lat: number;

  @IsNumber()
  @IsLongitude()
  lon: number;

  @IsIn(CURATED_PRECISIONS)
  precision: CuratedPrecision;
}

/**
 * Body of `PATCH /admin/distillery-locations/:id`. Absent keys are left
 * unchanged; the id never changes, even on a rename.
 */
export class UpdateDistilleryLocationDto {
  // Not @IsOptional: that would let `null` through to NOT NULL columns.
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsNumber()
  @IsLatitude()
  lat?: number;

  @ValidateIf((_, v) => v !== undefined)
  @IsNumber()
  @IsLongitude()
  lon?: number;

  @ValidateIf((_, v) => v !== undefined)
  @IsIn(CURATED_PRECISIONS)
  precision?: CuratedPrecision;
}
