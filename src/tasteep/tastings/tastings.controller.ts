import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TasteepJwtAuthGuard } from '../auth/tasteep-jwt-auth.guard';
import type { TasteepAuthRequest } from '../auth/tasteep-jwt-auth.guard';
import { TastingsService } from './tastings.service';
import { SmwsMeService } from './smws-me.service';
import { UpsertTastingDto } from './dto/upsert-tasting.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { PHOTO_MAX_UPLOAD_BYTES } from '../photos/photo-processor';

const isTruthy = (v: string | undefined) => v === 'true' || v === '1';

/** Journal entries. Matches `RemoteTastingRepository` in the Flutter client. */
@Controller('tasteep/tastings')
@UseGuards(TasteepJwtAuthGuard)
export class TastingsController {
  constructor(private readonly tastings: TastingsService) {}

  /**
   * `?unplaced=true` → only `unknown`/`country` precision (the "NOT PLACED"
   * shelf). `?smws_sku=` → the tastings of one SMWS bottle;
   * `?smws_distillery=29` → those of one SMWS distillery code.
   */
  @Get()
  list(
    @Req() req: TasteepAuthRequest,
    @Query('unplaced') unplaced?: string,
    @Query('smws_sku') smwsSku?: string,
    @Query('smws_distillery') smwsDistillery?: string,
  ) {
    return this.tastings.list(req.user.sub, {
      unplaced: isTruthy(unplaced),
      smwsSku:
        typeof smwsSku === 'string' ? smwsSku.trim() || undefined : undefined,
      smwsDistillery:
        typeof smwsDistillery === 'string'
          ? smwsDistillery.trim() || undefined
          : undefined,
    });
  }

  /**
   * Starts a tasting from a catalog bottle: `:bottle` is a cask code (`1.309`)
   * or SKU. Declared before `:id` so `prefill` is not read as a tasting id.
   */
  @Get('prefill/:bottle')
  prefill(@Req() req: TasteepAuthRequest, @Param('bottle') bottle: string) {
    return this.tastings.prefill(req.user.sub, bottle);
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

  /**
   * Multipart upload, one file in the `photo` field. Replaces any previous
   * photo and returns the tasting with fresh `photo_url`/`photo_thumb_url`.
   * The tasting must exist first (`404` otherwise). `413` above 20 MB.
   */
  @Put(':id/photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: PHOTO_MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  setPhoto(
    @Req() req: TasteepAuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ) {
    if (!photo?.buffer?.length) {
      throw new BadRequestException(
        'Send the image as multipart/form-data in a "photo" field.',
      );
    }
    return this.tastings.setPhoto(req.user.sub, id, photo.buffer);
  }

  @Delete(':id/photo')
  removePhoto(
    @Req() req: TasteepAuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tastings.removePhoto(req.user.sub, id);
  }
}

/** Aggregates over the journal: the Profile stat grid. */
@Controller('tasteep')
@UseGuards(TasteepJwtAuthGuard)
export class TastingAggregatesController {
  constructor(
    private readonly tastings: TastingsService,
    private readonly smwsMe: SmwsMeService,
  ) {}

  @Get('stats')
  stats(@Req() req: TasteepAuthRequest) {
    return this.tastings.stats(req.user.sub);
  }

  /** The user's SMWS progress, from tastings linked to a catalog bottle. */
  @Get('smws/me')
  smws(@Req() req: TasteepAuthRequest) {
    return this.smwsMe.forUser(req.user.sub);
  }
}
