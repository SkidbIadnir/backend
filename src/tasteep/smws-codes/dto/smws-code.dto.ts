import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** `1`, `G1`, `RW1`: uppercase letters, then digits. */
export const SMWS_CODE_PATTERN = /^[A-Z]{0,4}[0-9]{1,4}$/;

/**
 * Body of `POST /admin/smws-codes`. `region_id` absent → resolved from
 * `region` against the picker; `400` if given and unknown.
 */
export class CreateSmwsCodeDto {
  @IsString()
  @Matches(SMWS_CODE_PATTERN, {
    message: 'code must look like an SMWS code prefix, e.g. 1, G1 or RW1',
  })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  distillery_name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  region?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  region_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  extra?: string | null;
}

/**
 * Body of `PATCH /admin/smws-codes/:code`. Absent keys are left unchanged; the
 * code itself can't change (delete and create instead).
 *
 * `region_id`: a key from `GET /tasteep/regions`, or `null` to unlink; `400`
 * if unknown. When it is absent but `region` is sent, the link is re-resolved
 * from the new text.
 */
export class UpdateSmwsCodeDto {
  // Not @IsOptional: that would let `null` through to a NOT NULL column.
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  distillery_name?: string;

  // Not @IsOptional: that would let `null` through to a NOT NULL column.
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  region?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  region_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  extra?: string | null;
}
