import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { WishlistFoldersService } from './wishlist-folders.service';
import { TasteepWishlistFolder } from '../entities/tasteep-wishlist-folder.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';
import {
  makeUpsertFolderDto,
  makeWishlistFolder,
  OTHER_USER_ID,
  USER_ID,
  WISHLIST_FOLDER_ID,
} from '../test-utils/fixtures';

describe('WishlistFoldersService', () => {
  let service: WishlistFoldersService;
  let repo: MockRepository<TasteepWishlistFolder>;

  beforeEach(async () => {
    repo = createMockRepository<TasteepWishlistFolder>();
    const module = await Test.createTestingModule({
      providers: [
        WishlistFoldersService,
        { provide: getRepositoryToken(TasteepWishlistFolder), useValue: repo },
      ],
    }).compile();
    service = module.get(WishlistFoldersService);
  });

  describe('list', () => {
    it('scopes to the user, ordered by sort_order then name', async () => {
      repo.find!.mockResolvedValue([makeWishlistFolder()]);
      const result = await service.list(USER_ID);
      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
      expect(result[0].id).toBe(WISHLIST_FOLDER_ID);
    });
  });

  describe('upsert', () => {
    it('creates a row with the client id when none exists', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeWishlistFolder());
      repo.save!.mockImplementation(async (f: TasteepWishlistFolder) => f);

      const result = await service.upsert(
        USER_ID,
        WISHLIST_FOLDER_ID,
        makeUpsertFolderDto(),
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: WISHLIST_FOLDER_ID, userId: USER_ID }),
      );
      expect(result.name).toBe('Next Purchase');
    });

    it('replaces an existing row in place', async () => {
      const existing = makeWishlistFolder({ name: 'Old name' });
      repo
        .findOne!.mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ ...existing, name: 'New name' });
      repo.save!.mockImplementation(async (f: TasteepWishlistFolder) => f);

      const result = await service.upsert(
        USER_ID,
        WISHLIST_FOLDER_ID,
        makeUpsertFolderDto({ name: 'New name' }),
      );

      expect(repo.create).not.toHaveBeenCalled();
      expect(result.name).toBe('New name');
    });

    it('rejects an id that belongs to another account', async () => {
      repo.findOne!.mockResolvedValueOnce(
        makeWishlistFolder({ userId: OTHER_USER_ID }),
      );
      await expect(
        service.upsert(USER_ID, WISHLIST_FOLDER_ID, makeUpsertFolderDto()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes only within the user scope', async () => {
      repo.delete!.mockResolvedValue({ affected: 1 });
      await service.remove(USER_ID, WISHLIST_FOLDER_ID);
      expect(repo.delete).toHaveBeenCalledWith({
        id: WISHLIST_FOLDER_ID,
        userId: USER_ID,
      });
    });

    it('404s when nothing was deleted', async () => {
      repo.delete!.mockResolvedValue({ affected: 0 });
      await expect(
        service.remove(USER_ID, WISHLIST_FOLDER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
