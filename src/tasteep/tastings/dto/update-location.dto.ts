import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { LOCATION_PRECISIONS } from '../../entities/tasteep-tasting.entity';
import type { LocationPrecision } from '../../entities/tasteep-tasting.entity';

/**
 * Body of `PUT /tasteep/tastings/:id/location`.
 *  - `manual`  → pin drop; lat/lon required, wins over any later automated result
 *  - `exact` / `region` / `country` → automated geocode result; rejected if the tasting is already `manual`
 *  - `unknown` → explicit clear; lat/lon are set to null
 */
export class UpdateLocationDto {
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

  @IsIn(LOCATION_PRECISIONS)
  precision: LocationPrecision;
}
