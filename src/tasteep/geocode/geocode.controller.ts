import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TasteepJwtAuthGuard } from '../auth/tasteep-jwt-auth.guard';
import { GeocodeService } from './geocode.service';

export class GeocodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  query: string;
}

/** `POST /tasteep/geocode {query}` → `{lat, lon, precision}` or 404. */
@Controller('tasteep/geocode')
@UseGuards(TasteepJwtAuthGuard)
export class GeocodeController {
  constructor(private readonly geocode: GeocodeService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  resolve(@Body() dto: GeocodeDto) {
    return this.geocode.resolve(dto.query);
  }
}
