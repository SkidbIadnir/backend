import { Test } from '@nestjs/testing';
import {
  WishlistFoldersController,
  WishlistItemsController,
} from './wishlist.controller';
import { WishlistFoldersService } from './wishlist-folders.service';
import { WishlistItemsService } from './wishlist-items.service';
import {
  USER_ID,
  WISHLIST_FOLDER_ID,
  WISHLIST_ITEM_ID,
} from '../test-utils/fixtures';
import type { TasteepAuthRequest } from '../auth/tasteep-jwt-auth.guard';

const req = { user: { sub: USER_ID, sid: 'sid' } } as TasteepAuthRequest;

describe('Tasteep wishlist controllers', () => {
  let folders: WishlistFoldersController;
  let items: WishlistItemsController;
  let foldersService: Record<string, jest.Mock>;
  let itemsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    foldersService = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn(),
      upsert: jest.fn(),
      remove: jest.fn(),
    };
    itemsService = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn(),
      upsert: jest.fn(),
      remove: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [WishlistFoldersController, WishlistItemsController],
      providers: [
        { provide: WishlistFoldersService, useValue: foldersService },
        { provide: WishlistItemsService, useValue: itemsService },
      ],
    }).compile();
    folders = module.get(WishlistFoldersController);
    items = module.get(WishlistItemsController);
  });

  describe('WishlistFoldersController', () => {
    it('routes list/get/upsert/delete to the service with the user id', async () => {
      const dto = { name: 'x' };
      await folders.list(req);
      await folders.get(req, WISHLIST_FOLDER_ID);
      await folders.upsert(req, WISHLIST_FOLDER_ID, dto);
      await folders.remove(req, WISHLIST_FOLDER_ID);

      expect(foldersService.list).toHaveBeenCalledWith(USER_ID);
      expect(foldersService.get).toHaveBeenCalledWith(
        USER_ID,
        WISHLIST_FOLDER_ID,
      );
      expect(foldersService.upsert).toHaveBeenCalledWith(
        USER_ID,
        WISHLIST_FOLDER_ID,
        dto,
      );
      expect(foldersService.remove).toHaveBeenCalledWith(
        USER_ID,
        WISHLIST_FOLDER_ID,
      );
    });
  });

  describe('WishlistItemsController', () => {
    it('passes folder_id and unfiled query params through', async () => {
      await items.list(req, WISHLIST_FOLDER_ID, undefined);
      await items.list(req, undefined, 'true');
      await items.list(req, undefined, undefined);

      expect(itemsService.list.mock.calls[0]).toEqual([
        USER_ID,
        { folderId: WISHLIST_FOLDER_ID, unfiled: false },
      ]);
      expect(itemsService.list.mock.calls[1]).toEqual([
        USER_ID,
        { folderId: undefined, unfiled: true },
      ]);
      expect(itemsService.list.mock.calls[2]).toEqual([
        USER_ID,
        { folderId: undefined, unfiled: false },
      ]);
    });

    it('routes get/upsert/delete to the service with the user id', async () => {
      const dto = { name: 'Springbank 15' };
      await items.get(req, WISHLIST_ITEM_ID);
      await items.upsert(req, WISHLIST_ITEM_ID, dto);
      await items.remove(req, WISHLIST_ITEM_ID);

      expect(itemsService.get).toHaveBeenCalledWith(USER_ID, WISHLIST_ITEM_ID);
      expect(itemsService.upsert).toHaveBeenCalledWith(
        USER_ID,
        WISHLIST_ITEM_ID,
        dto,
      );
      expect(itemsService.remove).toHaveBeenCalledWith(
        USER_ID,
        WISHLIST_ITEM_ID,
      );
    });
  });
});
