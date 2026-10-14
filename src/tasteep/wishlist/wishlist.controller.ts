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
import { WishlistFoldersService } from './wishlist-folders.service';
import { WishlistItemsService } from './wishlist-items.service';
import { UpsertWishlistFolderDto } from './dto/upsert-wishlist-folder.dto';
import { UpsertWishlistItemDto } from './dto/upsert-wishlist-item.dto';

const isTruthy = (v: string | undefined) => v === 'true' || v === '1';

/** Flat folders for filing wishlist items. */
@Controller('tasteep/wishlist/folders')
@UseGuards(TasteepJwtAuthGuard)
export class WishlistFoldersController {
  constructor(private readonly folders: WishlistFoldersService) {}

  @Get()
  list(@Req() req: TasteepAuthRequest) {
    return this.folders.list(req.user.sub);
  }

  @Get(':id')
  get(@Req() req: TasteepAuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.folders.get(req.user.sub, id);
  }

  @Put(':id')
  upsert(
    @Req() req: TasteepAuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertWishlistFolderDto,
  ) {
    return this.folders.upsert(req.user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Req() req: TasteepAuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.folders.remove(req.user.sub, id);
  }
}

/** Bottles the user wants to buy. `?folder_id=` narrows to one folder, `?unfiled=true` to none. */
@Controller('tasteep/wishlist/items')
@UseGuards(TasteepJwtAuthGuard)
export class WishlistItemsController {
  constructor(private readonly items: WishlistItemsService) {}

  @Get()
  list(
    @Req() req: TasteepAuthRequest,
    @Query('folder_id') folderId?: string,
    @Query('unfiled') unfiled?: string,
  ) {
    return this.items.list(req.user.sub, {
      folderId,
      unfiled: isTruthy(unfiled),
    });
  }

  @Get(':id')
  get(@Req() req: TasteepAuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.items.get(req.user.sub, id);
  }

  @Put(':id')
  upsert(
    @Req() req: TasteepAuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertWishlistItemDto,
  ) {
    return this.items.upsert(req.user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Req() req: TasteepAuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.items.remove(req.user.sub, id);
  }
}
