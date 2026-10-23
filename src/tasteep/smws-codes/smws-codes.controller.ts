import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { TasteepJwtAuthGuard } from '../auth/tasteep-jwt-auth.guard';
import { SmwsCodesService } from './smws-codes.service';

/**
 * `GET /tasteep/smws-codes` → `{ version, items }`, every live SMWS code for
 * the app's offline copy.
 *
 * `version` is a content hash (see `snapshotVersion`) and doubles as a weak
 * `ETag`: a client that sends it back in `If-None-Match` gets `304` and no
 * body. A deleted code simply disappears from `items`, so replacing the
 * stored copy wholesale is always correct.
 */
@Controller('tasteep/smws-codes')
@UseGuards(TasteepJwtAuthGuard)
export class SmwsCodesController {
  constructor(private readonly codes: SmwsCodesService) {}

  @Get()
  async list(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const snapshot = await this.codes.snapshot();
    const etag = `W/"${snapshot.version}"`;
    res.setHeader('ETag', etag);
    if (ifNoneMatch === etag) {
      res.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    return snapshot;
  }
}
