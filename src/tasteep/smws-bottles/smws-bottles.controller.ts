import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TasteepJwtAuthGuard } from '../auth/tasteep-jwt-auth.guard';
import { SmwsBottlesService } from './smws-bottles.service';
import type { BottleSearchQuery } from './smws-bottle.search';

/**
 * SMWS bottles seen on smws.eu, current and past. Shared reference data (not
 * per user), so any signed-in user reads the same list.
 *
 * - `GET /tasteep/smws-bottles` → `{ total, items }`: the shop's list
 *   (available bottles, newest first).
 * - `GET /tasteep/smws-bottles/search?q=` → `{ total, items }`: every bottle
 *   ever seen, best match first, for the app's bottle picker.
 * - `GET /tasteep/smws-bottles/facets` → filter values and ranges.
 * - `GET /tasteep/smws-bottles/:id` (cask code or SKU) → one bottle.
 *
 * The list and the search take the same filters; see `BottleSearchQuery`.
 */
@Controller('tasteep/smws-bottles')
@UseGuards(TasteepJwtAuthGuard)
export class SmwsBottlesController {
  constructor(private readonly bottles: SmwsBottlesService) {}

  @Get()
  list(@Query() query: BottleSearchQuery) {
    return this.bottles.list(query);
  }

  @Get('search')
  search(@Query() query: BottleSearchQuery) {
    return this.bottles.search(query);
  }

  @Get('facets')
  facets() {
    return this.bottles.facets();
  }

  /** By cask code (`1.309`) or SKU. */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.bottles.get(id);
  }
}
