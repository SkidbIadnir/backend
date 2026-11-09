import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TasteepJwtAuthGuard } from '../auth/tasteep-jwt-auth.guard';
import { SmwsBottlesService } from './smws-bottles.service';

/**
 * SMWS bottles seen on smws.eu, current and past. Shared reference data (not
 * per user), so any signed-in user reads the same list.
 *
 * `GET /tasteep/smws-bottles?status=available|delisted|all&kind=single_cask|blend&distillery_code=&region_id=&limit=&offset=`
 * → `{ total, items }`. `GET /tasteep/smws-bottles/:id` (cask code or SKU) → one bottle.
 */
@Controller('tasteep/smws-bottles')
@UseGuards(TasteepJwtAuthGuard)
export class SmwsBottlesController {
  constructor(private readonly bottles: SmwsBottlesService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('distillery_code') distilleryCode?: string,
    @Query('region_id') regionId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.bottles.list({
      status,
      kind,
      distillery_code: distilleryCode,
      region_id: regionId,
      limit,
      offset,
    });
  }

  /** By cask code (`1.309`) or SKU. */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.bottles.get(id);
  }
}
