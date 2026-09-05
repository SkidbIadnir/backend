import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RequestEmailCodeDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email: string;
}

export class VerifyEmailCodeDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  id_token: string;
}

export class DiscordLoginDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  /** Must equal the redirect URI the app used when opening the Discord authorize page. */
  @IsOptional()
  @IsString()
  redirect_uri?: string;
}
