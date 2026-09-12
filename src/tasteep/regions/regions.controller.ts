import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Res,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { TasteepJwtAuthGuard } from '../auth/tasteep-jwt-auth.guard';
import { RegionsService } from './regions.service';

/**
 * `GET /tasteep/regions` → the region picker as a two-level tree.
 *
 * The list changes only when the seed file changes, so the response carries a
 * weak `ETag`; a client that sends it back in `If-None-Match` gets `304` and
 * no body.
 */
@Controller('tasteep/regions')
@UseGuards(TasteepJwtAuthGuard)
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  @Get()
  async list(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tree = await this.regions.tree();
    const etag = `W/"${createHash('sha1').update(JSON.stringify(tree)).digest('hex')}"`;
    res.setHeader('ETag', etag);
    if (ifNoneMatch === etag) {
      res.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    return tree;
  }
}
