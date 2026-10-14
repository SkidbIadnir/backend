import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
import { WishlistItemsService } from './wishlist-items.service';
import { RegionsService } from '../regions/regions.service';
import { TasteepWishlistItem } from '../entities/tasteep-wishlist-item.entity';
import { TasteepWishlistFolder } from '../entities/tasteep-wishlist-folder.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';
import {
  makeRegion,
  makeTasting,
  makeUpsertItemDto,
  makeWishlistFolder,
  makeWishlistItem,
  OTHER_USER_ID,
  TASTING_ID,
  USER_ID,
  WISHLIST_FOLDER_ID,
  WISHLIST_ITEM_ID,
} from '../test-utils/fixtures';

describe('WishlistItemsService', () => {
  let service: WishlistItemsService;
  let repo: MockRepository<TasteepWishlistItem>;
  let foldersRepo: MockRepository<TasteepWishlistFolder>;
  let tastingsRepo: MockRepository<TasteepTasting>;
  const regions = { resolve: jest.fn() };

  beforeEach(async () => {
    repo = createMockRepository<TasteepWishlistItem>();
    foldersRepo = createMockRepository<TasteepWishlistFolder>();
    tastingsRepo = createMockRepository<TasteepTasting>();
    regions.resolve.mockReset().mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        WishlistItemsService,
        { provide: getRepositoryToken(TasteepWishlistItem), useValue: repo },
        {
          provide: getRepositoryToken(TasteepWishlistFolder),
          useValue: foldersRepo,
        },
        { provide: getRepositoryToken(TasteepTasting), useValue: tastingsRepo },
        { provide: RegionsService, useValue: regions },
      ],
    }).compile();
    service = module.get(WishlistItemsService);
  });

  describe('list', () => {
    it('scopes to the user, newest first', async () => {
      repo.find!.mockResolvedValue([makeWishlistItem()]);
      const result = await service.list(USER_ID);
      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        order: { createdAt: 'DESC' },
      });
      expect(result[0].id).toBe(WISHLIST_ITEM_ID);
    });

    it('filters to a single folder when folderId is given', async () => {
      repo.find!.mockResolvedValue([]);
      await service.list(USER_ID, { folderId: WISHLIST_FOLDER_ID });
      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: USER_ID, folderId: WISHLIST_FOLDER_ID },
        order: { createdAt: 'DESC' },
      });
    });

    it('filters to unfiled items when unfiled is set', async () => {
      repo.find!.mockResolvedValue([]);
      await service.list(USER_ID, { unfiled: true });
      const where = repo.find!.mock.calls[0][0].where;
      expect(where.userId).toBe(USER_ID);
      expect(where.folderId).toEqual(IsNull());
    });
  });

  describe('upsert', () => {
    it('creates a row with the client id when none exists', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeWishlistItem());
      repo.save!.mockImplementation(async (i: TasteepWishlistItem) => i);
      foldersRepo.findOne!.mockResolvedValue(makeWishlistFolder());

      const result = await service.upsert(
        USER_ID,
        WISHLIST_ITEM_ID,
        makeUpsertItemDto(),
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: WISHLIST_ITEM_ID, userId: USER_ID }),
      );
      expect(result.name).toBe('Springbank 15');
      expect(result.folder_id).toBe(WISHLIST_FOLDER_ID);
    });

    it('rejects an id that belongs to another account', async () => {
      repo.findOne!.mockResolvedValueOnce(
        makeWishlistItem({ userId: OTHER_USER_ID }),
      );
      await expect(
        service.upsert(USER_ID, WISHLIST_ITEM_ID, makeUpsertItemDto()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('clears the folder when folder_id is absent', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeWishlistItem({ folderId: null }));
      repo.save!.mockImplementation(async (i: TasteepWishlistItem) => i);

      await service.upsert(
        USER_ID,
        WISHLIST_ITEM_ID,
        makeUpsertItemDto({ folder_id: null }),
      );

      expect(foldersRepo.findOne).not.toHaveBeenCalled();
      expect(repo.save!.mock.calls[0][0].folderId).toBeNull();
    });

    it('rejects a folder_id that does not belong to the user', async () => {
      repo.findOne!.mockResolvedValueOnce(null);
      foldersRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.upsert(USER_ID, WISHLIST_ITEM_ID, makeUpsertItemDto()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(foldersRepo.findOne).toHaveBeenCalledWith({
        where: { id: WISHLIST_FOLDER_ID, userId: USER_ID },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('links the region the text or id resolves to, keeping the typed text', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeWishlistItem());
      repo.save!.mockImplementation(async (i: TasteepWishlistItem) => i);
      foldersRepo.findOne!.mockResolvedValue(makeWishlistFolder());
      regions.resolve.mockResolvedValue(makeRegion());

      await service.upsert(
        USER_ID,
        WISHLIST_ITEM_ID,
        makeUpsertItemDto({ region: 'islay, scotland', region_id: null }),
      );

      expect(regions.resolve).toHaveBeenCalledWith(null, 'islay, scotland');
      expect(repo.save!.mock.calls[0][0]).toMatchObject({
        region: 'islay, scotland',
        regionId: 'scotland/islay',
      });
    });

    it('propagates a 400 for an unknown region_id and saves nothing', async () => {
      repo.findOne!.mockResolvedValueOnce(null);
      foldersRepo.findOne!.mockResolvedValue(makeWishlistFolder());
      regions.resolve.mockRejectedValue(new BadRequestException('nope'));

      await expect(
        service.upsert(
          USER_ID,
          WISHLIST_ITEM_ID,
          makeUpsertItemDto({ region_id: 'x' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('clears the fulfilled tasting link when absent', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeWishlistItem());
      repo.save!.mockImplementation(async (i: TasteepWishlistItem) => i);
      foldersRepo.findOne!.mockResolvedValue(makeWishlistFolder());

      await service.upsert(
        USER_ID,
        WISHLIST_ITEM_ID,
        makeUpsertItemDto({ fulfilled_tasting_id: null }),
      );

      expect(tastingsRepo.findOne).not.toHaveBeenCalled();
      expect(repo.save!.mock.calls[0][0].fulfilledTastingId).toBeNull();
    });

    it('links a fulfilled tasting owned by the same user', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeWishlistItem());
      repo.save!.mockImplementation(async (i: TasteepWishlistItem) => i);
      foldersRepo.findOne!.mockResolvedValue(makeWishlistFolder());
      tastingsRepo.findOne!.mockResolvedValue(makeTasting());

      await service.upsert(
        USER_ID,
        WISHLIST_ITEM_ID,
        makeUpsertItemDto({ fulfilled_tasting_id: TASTING_ID }),
      );

      expect(tastingsRepo.findOne).toHaveBeenCalledWith({
        where: { id: TASTING_ID, userId: USER_ID },
      });
      expect(repo.save!.mock.calls[0][0].fulfilledTastingId).toBe(TASTING_ID);
    });

    it('rejects a fulfilled_tasting_id that does not belong to the user', async () => {
      repo.findOne!.mockResolvedValueOnce(null);
      foldersRepo.findOne!.mockResolvedValue(makeWishlistFolder());
      tastingsRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.upsert(
          USER_ID,
          WISHLIST_ITEM_ID,
          makeUpsertItemDto({ fulfilled_tasting_id: TASTING_ID }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes only within the user scope', async () => {
      repo.delete!.mockResolvedValue({ affected: 1 });
      await service.remove(USER_ID, WISHLIST_ITEM_ID);
      expect(repo.delete).toHaveBeenCalledWith({
        id: WISHLIST_ITEM_ID,
        userId: USER_ID,
      });
    });

    it('404s when nothing was deleted', async () => {
      repo.delete!.mockResolvedValue({ affected: 0 });
      await expect(
        service.remove(USER_ID, WISHLIST_ITEM_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
