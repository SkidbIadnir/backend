import {
  applyUpsertFolderDto,
  applyUpsertItemDto,
  toFolderJson,
  toItemJson,
} from './wishlist.mapper';
import {
  makeUpsertFolderDto,
  makeUpsertItemDto,
  makeWishlistFolder,
  makeWishlistItem,
  USER_ID,
  WISHLIST_FOLDER_ID,
  WISHLIST_ITEM_ID,
} from '../test-utils/fixtures';
import { TasteepWishlistFolder } from '../entities/tasteep-wishlist-folder.entity';
import { TasteepWishlistItem } from '../entities/tasteep-wishlist-item.entity';

describe('wishlist.mapper', () => {
  describe('toFolderJson', () => {
    it('emits the exact snake_case contract', () => {
      const json = toFolderJson(makeWishlistFolder());
      expect(Object.keys(json).sort()).toEqual(
        ['id', 'name', 'sort_order', 'created_at', 'updated_at'].sort(),
      );
      expect(json.created_at).toBe('2026-01-01T00:00:00.000Z');
    });

    it('defaults sort_order to 0 when absent', () => {
      const bare = {
        id: WISHLIST_FOLDER_ID,
        userId: USER_ID,
        name: 'x',
      } as TasteepWishlistFolder;
      expect(toFolderJson(bare).sort_order).toBe(0);
      expect(toFolderJson(bare).created_at).toBeNull();
    });
  });

  describe('applyUpsertFolderDto', () => {
    it('copies name and sort_order', () => {
      const f = applyUpsertFolderDto(
        { id: WISHLIST_FOLDER_ID, userId: USER_ID } as TasteepWishlistFolder,
        makeUpsertFolderDto({ name: 'Someday', sort_order: 2 }),
      );
      expect(f.name).toBe('Someday');
      expect(f.sortOrder).toBe(2);
    });

    it('is a full replacement: an absent sort_order resets to 0', () => {
      const existing = makeWishlistFolder({ sortOrder: 5 });
      const f = applyUpsertFolderDto(existing, { name: 'Renamed' });
      expect(f.sortOrder).toBe(0);
    });
  });

  describe('toItemJson', () => {
    it('emits the exact snake_case contract, deriving fulfilled from the tasting link', () => {
      const json = toItemJson(makeWishlistItem());
      expect(Object.keys(json).sort()).toEqual(
        [
          'id',
          'folder_id',
          'name',
          'distillery',
          'region',
          'region_id',
          'category',
          'target_price',
          'why_i_want',
          'where_to_buy',
          'fulfilled_tasting_id',
          'fulfilled',
          'created_at',
          'updated_at',
        ].sort(),
      );
      expect(json.fulfilled).toBe(false);
    });

    it('flips fulfilled to true purely off fulfilled_tasting_id', () => {
      const json = toItemJson(
        makeWishlistItem({ fulfilledTastingId: 'some-tasting-id' }),
      );
      expect(json.fulfilled).toBe(true);
      expect(json.fulfilled_tasting_id).toBe('some-tasting-id');
    });

    it('turns undefined optional fields into null', () => {
      const bare = {
        id: WISHLIST_ITEM_ID,
        userId: USER_ID,
        name: 'x',
      } as TasteepWishlistItem;
      const json = toItemJson(bare);
      expect(json.folder_id).toBeNull();
      expect(json.category).toBeNull();
      expect(json.target_price).toBeNull();
      expect(json.fulfilled).toBe(false);
      expect(json.created_at).toBeNull();
    });
  });

  describe('applyUpsertItemDto', () => {
    it('copies every field', () => {
      const i = applyUpsertItemDto(
        { id: WISHLIST_ITEM_ID, userId: USER_ID } as TasteepWishlistItem,
        makeUpsertItemDto(),
      );
      expect(i.name).toBe('Springbank 15');
      expect(i.folderId).toBe(WISHLIST_FOLDER_ID);
      expect(i.targetPrice).toBe(98);
      expect(i.category).toBe('whisky');
    });

    it('is a full replacement: absent keys become null', () => {
      const existing = makeWishlistItem({
        targetPrice: 500,
        fulfilledTastingId: 'x',
      });
      const i = applyUpsertItemDto(existing, { name: 'Only a name' });
      expect(i.folderId).toBeNull();
      expect(i.category).toBeNull();
      expect(i.targetPrice).toBeNull();
      expect(i.whyIWant).toBeNull();
      expect(i.fulfilledTastingId).toBeNull();
    });
  });
});
