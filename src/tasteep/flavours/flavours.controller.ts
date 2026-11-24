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
import { FlavoursService } from './flavours.service';

/**
 * `GET /tasteep/flavours` → the flavour vocabulary as a two-level tree, for
 * the tag picker. Weak `ETag`; send it back in `If-None-Match` for a `304`.
 */
@Controller('tasteep/flavours')
@UseGuards(TasteepJwtAuthGuard)
export class FlavoursController {
  constructor(private readonly flavours: FlavoursService) {}

  @Get()
  async list(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tree = await this.flavours.tree();
    const etag = `W/"${createHash('sha1').update(JSON.stringify(tree)).digest('hex')}"`;
    res.setHeader('ETag', etag);
    if (ifNoneMatch === etag) {
      res.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    return tree;
  }
}
