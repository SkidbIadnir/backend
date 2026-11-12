import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PhotoStorageService } from './photo-storage.service';
import { PHOTO_SIZES, PhotoSize, verifyPhotoSignature } from './photo-url';

/**
 * Serves tasting photos. No bearer token: the signed URL in a tasting's
 * `photo_url` / `photo_thumb_url` *is* the authorization, so Flutter's
 * `Image.network` can load it on every platform.
 */
@Controller('tasteep/photos')
export class PhotosController {
  constructor(private readonly storage: PhotoStorageService) {}

  /**
   * `403` when the signature is wrong or expired (re-fetch the tasting for a
   * fresh URL), `404` when the photo was replaced or deleted.
   */
  @Get(':photoId/:size')
  async serve(
    @Param('photoId', new ParseUUIDPipe({ version: '4' })) photoId: string,
    @Param('size') size: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!PHOTO_SIZES.includes(size as PhotoSize)) {
      throw new NotFoundException('Unknown photo size.');
    }
    const expSeconds = Number(exp);
    if (
      typeof sig !== 'string' ||
      !verifyPhotoSignature(photoId, size as PhotoSize, expSeconds, sig)
    ) {
      throw new ForbiddenException('Invalid or expired photo URL.');
    }
    if (!(await this.storage.exists(photoId, size as PhotoSize))) {
      throw new NotFoundException('Photo not found.');
    }

    // A photo id's bytes never change (a new upload gets a new id), so the
    // file can be cached for as long as this URL is valid.
    const maxAge = Math.max(0, expSeconds - Math.floor(Date.now() / 1000));
    res.setHeader('Cache-Control', `private, max-age=${maxAge}, immutable`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await new Promise<void>((resolve, reject) =>
      res.sendFile(
        this.storage.path(photoId, size as PhotoSize),
        { cacheControl: false, dotfiles: 'deny' },
        (err) => (err && !res.headersSent ? reject(err) : resolve()),
      ),
    );
  }
}
