import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class CreateAlertDto {
  @IsEnum(['distillery', 'region', 'age'], {
    message: 'alertType must be one of: distillery, region, age',
  })
  alertType: string;

  @IsString()
  @IsNotEmpty()
  alertValue: string;
}
