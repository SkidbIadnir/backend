import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TasteepJwtAuthGuard } from '../auth/tasteep-jwt-auth.guard';
import type { TasteepAuthRequest } from '../auth/tasteep-jwt-auth.guard';
import { TastingsService } from './tastings.service';
import { UpsertTastingDto } from './dto/upsert-tasting.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

const isTruthy = (v: string | undefined) => v === 'true' || v === '1';

/** Journal entries. Matches `RemoteTastingRepository` in the Flutter client. */
@Controller('tasteep/tastings')
@UseGuards(TasteepJwtAuthGuard)
export class TastingsController {
  constructor(private readonly tastings: TastingsService) {}

  /** `?unplaced=true` → only `unknown`/`country` precision (the "NOT PLACED" shelf). */
  @Get()
  list(@Req() req: TasteepAuthRequest, @Query('unplaced') unplaced?: string) {
    return this.tastings.list(req.user.sub, { unplaced: isTruthy(unplaced) });
  }

  @Get(':id')
  get(@Req() req: TasteepAuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.tastings.get(req.user.sub, id);
  }

  @Put(':id')
  upsert(
    @Req() req: TasteepAuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertTastingDto,
  ) {
    return this.tastings.upsert(req.user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Req() req: TasteepAuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tastings.remove(req.user.sub, id);
  }

  @Put(':id/location')
  updateLocation(
    @Req() req: TasteepAuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.tastings.updateLocation(req.user.sub, id, dto);
  }
}

/** Aggregates over the journal: Profile stat grid and the Atlas Cabinet view. */
@Controller('tasteep')
@UseGuards(TasteepJwtAuthGuard)
export class TastingAggregatesController {
  constructor(private readonly tastings: TastingsService) {}

  @Get('stats')
  stats(@Req() req: TasteepAuthRequest) {
    return this.tastings.stats(req.user.sub);
  }

  @Get('cabinet')
  cabinet(@Req() req: TasteepAuthRequest) {
    return this.tastings.cabinet(req.user.sub);
  }
}
