import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TasteepJwtAuthGuard } from '../auth/tasteep-jwt-auth.guard';
import { SmwsBottlesService } from './smws-bottles.service';

/**
 * SMWS bottles seen on smws.eu, current and past. Shared reference data (not
 * per user), so any signed-in user reads the same list.
 *
 * `GET /tasteep/smws-bottles?status=available|delisted|all&distillery_code=&region_id=&limit=&offset=`
 * → `{ total, items }`. `GET /tasteep/smws-bottles/:code` → one bottle.
 */
@Controller('tasteep/smws-bottles')
@UseGuards(TasteepJwtAuthGuard)
export class SmwsBottlesController {
  constructor(private readonly bottles: SmwsBottlesService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('distillery_code') distilleryCode?: string,
    @Query('region_id') regionId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.bottles.list({
      status,
      distillery_code: distilleryCode,
      region_id: regionId,
      limit,
      offset,
    });
  }

  @Get(':code')
  get(@Param('code') code: string) {
    return this.bottles.get(code);
  }
}
