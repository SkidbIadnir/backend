import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasteepWishlistFolder } from '../entities/tasteep-wishlist-folder.entity';
import { TasteepWishlistItem } from '../entities/tasteep-wishlist-item.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { TasteepAuthModule } from '../auth/tasteep-auth.module';
import { RegionsModule } from '../regions/regions.module';
import { WishlistFoldersService } from './wishlist-folders.service';
import { WishlistItemsService } from './wishlist-items.service';
import {
  WishlistFoldersController,
  WishlistItemsController,
} from './wishlist.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TasteepWishlistFolder,
      TasteepWishlistItem,
      TasteepTasting,
    ]),
    TasteepAuthModule,
    RegionsModule,
  ],
  providers: [WishlistFoldersService, WishlistItemsService],
  controllers: [WishlistFoldersController, WishlistItemsController],
})
export class WishlistModule {}
