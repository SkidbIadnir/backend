import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateAlertDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(['distillery', 'region', 'age'], {
    message: 'alertType must be one of: distillery, region, age',
  })
  alertType?: string;

  @IsOptional()
  @IsString()
  alertValue?: string;
}
