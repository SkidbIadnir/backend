import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import sharp from 'sharp';
import { TastingsService } from './tastings.service';
import { RegionsService } from '../regions/regions.service';
import { SmwsBottlesService } from '../smws-bottles/smws-bottles.service';
import { PhotoStorageService } from '../photos/photo-storage.service';
import type { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import {
  createMockQueryBuilder,
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';
import {
  makeRegion,
  makeTasting,
  makeUpsertDto,
  OTHER_USER_ID,
  TASTING_ID,
  USER_ID,
} from '../test-utils/fixtures';

describe('TastingsService', () => {
  let service: TastingsService;
  let repo: MockRepository<TasteepTasting>;
  const regions = { resolve: jest.fn() };
  const bottles = { findRow: jest.fn(), findRowOrNull: jest.fn() };
  const photos = { save: jest.fn(), remove: jest.fn() };
  const OLD_PHOTO_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
  const bottle = (over: Partial<TasteepSmwsBottle> = {}) =>
    ({
      sku: '029311GX0700612',
      kind: 'single_cask',
      code: '29.311',
      distilleryCode: '29',
      caskNo: '311',
      batch: null,
      name: 'Diesel à la crème',
      url: 'https://smws.eu/diesel-a-la-creme',
      smwsCode: { distilleryName: 'Laphroaig', category: 'single malt' },
      regionText: 'Islay',
      regionId: 'scotland/islay',
      priceText: '€120.00',
      priceAmount: 120,
      priceCurrency: 'EUR',
      abv: 58.4,
      age: '10 years',
      caskType: '1st fill US oak ex-oloroso barrel',
      distilledDate: '2014-03-01',
      profile: null,
      categories: [],
      releasedAt: null,
      inStock: false,
      stock: null,
      firstSeenAt: new Date('2026-11-01T00:00:00Z'),
      lastSeenAt: new Date('2026-11-09T00:00:00Z'),
      delistedAt: null,
      ...over,
    }) as TasteepSmwsBottle;

  beforeEach(async () => {
    repo = createMockRepository<TasteepTasting>();
    regions.resolve.mockReset().mockResolvedValue(null);
    bottles.findRow.mockReset();
    bottles.findRowOrNull.mockReset().mockResolvedValue(null);
    photos.save.mockReset().mockResolvedValue(undefined);
    photos.remove.mockReset().mockResolvedValue(undefined);
    process.env.TASTEEP_PHOTO_URL_SECRET = 'unit-test-photo-secret';
    const module = await Test.createTestingModule({
      providers: [
        TastingsService,
        { provide: getRepositoryToken(TasteepTasting), useValue: repo },
        { provide: RegionsService, useValue: regions },
        { provide: SmwsBottlesService, useValue: bottles },
        { provide: PhotoStorageService, useValue: photos },
      ],
    }).compile();
    service = module.get(TastingsService);
  });

  describe('list', () => {
    it('scopes to the user, newest date_tasted first with undated last', async () => {
      repo.find!.mockResolvedValue([makeTasting()]);
      const result = await service.list(USER_ID);
      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        relations: { smwsBottle: true },
        order: {
          dateTasted: { direction: 'DESC', nulls: 'LAST' },
          createdAt: 'DESC',
        },
      });
      expect(result[0].id).toBe(TASTING_ID);
      expect(result[0].date_tasted).toBe('2026-03-10T19:00:00.000Z');
    });

    it('filters to one SMWS bottle or one SMWS distillery', async () => {
      repo.find!.mockResolvedValue([]);
      await service.list(USER_ID, { smwsSku: '029311GX0700612' });
      await service.list(USER_ID, { smwsDistillery: 'g1' });
      const calls = repo.find!.mock.calls as { where: object }[][];
      expect(calls[0][0].where).toEqual({
        userId: USER_ID,
        smwsSku: '029311GX0700612',
      });
      expect(calls[1][0].where).toEqual({
        userId: USER_ID,
        smwsBottle: { distilleryCode: 'G1' },
      });
    });

    it('filters to unknown/country precision when unplaced is set', async () => {
      repo.find!.mockResolvedValue([]);
      await service.list(USER_ID, { unplaced: true });
      const where = repo.find!.mock.calls[0][0].where;
      expect(where.userId).toBe(USER_ID);
      expect(where.locationPrecision).toEqual(In(['unknown', 'country']));
    });
  });

  describe('upsert', () => {
    it('creates a row with the client id when none exists', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTasting());
      repo.save!.mockImplementation(async (t: TasteepTasting) => t);

      const result = await service.upsert(USER_ID, TASTING_ID, makeUpsertDto());

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: TASTING_ID, userId: USER_ID }),
      );
      const saved = repo.save!.mock.calls[0][0] as TasteepTasting;
      expect(saved).toMatchObject({
        id: TASTING_ID,
        userId: USER_ID,
        name: 'Lagavulin 16',
        score: 88,
      });
      expect(result.id).toBe(TASTING_ID);
    });

    it('replaces an existing row in place', async () => {
      const existing = makeTasting({ score: 50 });
      repo
        .findOne!.mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ ...existing, score: 95 });
      repo.save!.mockImplementation(async (t: TasteepTasting) => t);

      const result = await service.upsert(
        USER_ID,
        TASTING_ID,
        makeUpsertDto({ score: 95 }),
      );

      expect(repo.create).not.toHaveBeenCalled();
      expect((repo.save!.mock.calls[0][0] as TasteepTasting).score).toBe(95);
      expect(result.score).toBe(95);
    });

    it('rejects an id that belongs to another account', async () => {
      repo.findOne!.mockResolvedValueOnce(
        makeTasting({ userId: OTHER_USER_ID }),
      );
      await expect(
        service.upsert(USER_ID, TASTING_ID, makeUpsertDto()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('keeps a manual pin when the body carries an automated precision', async () => {
      const pinned = makeTasting({
        lat: 55.6,
        lon: -6.1,
        locationPrecision: 'manual',
      });
      repo.findOne!.mockResolvedValueOnce(pinned).mockResolvedValueOnce(pinned);
      repo.save!.mockImplementation(async (t: TasteepTasting) => t);

      await service.upsert(
        USER_ID,
        TASTING_ID,
        makeUpsertDto({ lat: 1, lon: 2, location_precision: 'exact' }),
      );

      const saved = repo.save!.mock.calls[0][0] as TasteepTasting;
      expect(saved).toMatchObject({
        lat: 55.6,
        lon: -6.1,
        locationPrecision: 'manual',
      });
    });

    it('links the region the text or id resolves to, keeping the typed text', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTasting());
      repo.save!.mockImplementation(async (t: TasteepTasting) => t);
      regions.resolve.mockResolvedValue(makeRegion());

      await service.upsert(
        USER_ID,
        TASTING_ID,
        makeUpsertDto({ region: 'islay, scotland', region_id: null }),
      );

      expect(regions.resolve).toHaveBeenCalledWith(null, 'islay, scotland');
      expect(repo.save!.mock.calls[0][0]).toMatchObject({
        region: 'islay, scotland',
        regionId: 'scotland/islay',
      });
    });

    it('fills the region text from the picked region when the text is empty', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTasting());
      repo.save!.mockImplementation(async (t: TasteepTasting) => t);
      regions.resolve.mockResolvedValue(makeRegion());

      await service.upsert(
        USER_ID,
        TASTING_ID,
        makeUpsertDto({ region: null, region_id: 'scotland/islay' }),
      );

      expect(regions.resolve).toHaveBeenCalledWith('scotland/islay', null);
      expect(repo.save!.mock.calls[0][0]).toMatchObject({
        region: 'Islay',
        regionId: 'scotland/islay',
      });
    });

    it('stores a null link when nothing resolves, without touching the text', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTasting());
      repo.save!.mockImplementation(async (t: TasteepTasting) => t);

      await service.upsert(
        USER_ID,
        TASTING_ID,
        makeUpsertDto({ region: "Grandma's cellar" }),
      );

      expect(repo.save!.mock.calls[0][0]).toMatchObject({
        region: "Grandma's cellar",
        regionId: null,
      });
    });

    it('propagates a 400 for an unknown region_id and saves nothing', async () => {
      repo.findOne!.mockResolvedValueOnce(null);
      regions.resolve.mockRejectedValue(new BadRequestException('nope'));
      await expect(
        service.upsert(USER_ID, TASTING_ID, makeUpsertDto({ region_id: 'x' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('lets the client move a manual pin with another manual value', async () => {
      const pinned = makeTasting({
        lat: 55.6,
        lon: -6.1,
        locationPrecision: 'manual',
      });
      repo.findOne!.mockResolvedValueOnce(pinned).mockResolvedValueOnce(pinned);
      repo.save!.mockImplementation(async (t: TasteepTasting) => t);

      await service.upsert(
        USER_ID,
        TASTING_ID,
        makeUpsertDto({ lat: 1, lon: 2, location_precision: 'manual' }),
      );

      expect(repo.save!.mock.calls[0][0]).toMatchObject({
        lat: 1,
        lon: 2,
        locationPrecision: 'manual',
      });
    });
  });

  describe('SMWS bottle link', () => {
    const save = () => {
      repo.save!.mockImplementation((t: TasteepTasting) => Promise.resolve(t));
    };
    const saved = () => (repo.save!.mock.calls as TasteepTasting[][])[0][0];

    it('links the bottle the body names, by SKU or cask code', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTasting());
      save();
      bottles.findRowOrNull.mockResolvedValue(bottle());
      await service.upsert(
        USER_ID,
        TASTING_ID,
        makeUpsertDto({ smws_sku: '29.311' }),
      );
      expect(bottles.findRowOrNull).toHaveBeenCalledWith('29.311');
      expect(saved().smwsSku).toBe('029311GX0700612');
    });

    it('400s an unknown bottle and saves nothing', async () => {
      repo.findOne!.mockResolvedValueOnce(null);
      await expect(
        service.upsert(
          USER_ID,
          TASTING_ID,
          makeUpsertDto({ smws_sku: 'nope' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('unlinks on an explicit null', async () => {
      const linked = makeTasting({ smwsSku: '029311GX0700612' });
      repo.findOne!.mockResolvedValueOnce(linked).mockResolvedValueOnce(linked);
      save();
      await service.upsert(
        USER_ID,
        TASTING_ID,
        makeUpsertDto({ name: '29.311 Diesel', smws_sku: null }),
      );
      expect(saved().smwsSku).toBeNull();
      expect(bottles.findRowOrNull).not.toHaveBeenCalled();
    });

    it('keeps the stored link when the body leaves the key out', async () => {
      const linked = makeTasting({ smwsSku: '029311GX0700612' });
      repo.findOne!.mockResolvedValueOnce(linked).mockResolvedValueOnce(linked);
      save();
      await service.upsert(USER_ID, TASTING_ID, makeUpsertDto({ score: 90 }));
      expect(saved().smwsSku).toBe('029311GX0700612');
      expect(bottles.findRowOrNull).not.toHaveBeenCalled();
    });

    it('links from a cask code the name starts with', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTasting());
      save();
      bottles.findRowOrNull.mockResolvedValue(bottle());
      await service.upsert(
        USER_ID,
        TASTING_ID,
        makeUpsertDto({ name: 'SMWS 29.311 at the bar' }),
      );
      expect(bottles.findRowOrNull).toHaveBeenCalledWith('29.311');
      expect(saved().smwsSku).toBe('029311GX0700612');
    });

    it('leaves an ordinary name unlinked', async () => {
      repo
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTasting());
      save();
      await service.upsert(USER_ID, TASTING_ID, makeUpsertDto());
      expect(bottles.findRowOrNull).not.toHaveBeenCalled();
      expect(saved().smwsSku).toBeNull();
    });
  });

  describe('prefill', () => {
    it('fills a tasting from the bottle and lists earlier tastings of it', async () => {
      bottles.findRow.mockResolvedValue(bottle());
      repo.find!.mockResolvedValue([
        makeTasting({ name: '29.311 Diesel', smwsSku: '029311GX0700612' }),
      ]);
      const result = await service.prefill(USER_ID, '29.311');
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID, smwsSku: '029311GX0700612' },
        }),
      );
      expect(result.tasting).toEqual({
        name: '29.311 Diesel à la crème',
        category: 'whisky',
        distillery: 'Laphroaig',
        region: 'Islay',
        region_id: 'scotland/islay',
        abv: 58.4,
        price: 120,
        age_statement: '10',
        cask_type: '1st fill US oak ex-oloroso barrel',
        smws_sku: '029311GX0700612',
      });
      expect(result.bottle.code).toBe('29.311');
      expect(result.previous_tastings).toEqual([
        {
          id: TASTING_ID,
          name: '29.311 Diesel',
          date_tasted: '2026-03-10T19:00:00.000Z',
          score: 88,
        },
      ]);
    });

    it('propagates the 404 of an unknown bottle', async () => {
      bottles.findRow.mockRejectedValue(new NotFoundException());
      await expect(service.prefill(USER_ID, '9.999')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes only within the user scope', async () => {
      repo.findOne!.mockResolvedValue(makeTasting());
      repo.delete!.mockResolvedValue({ affected: 1 });
      await service.remove(USER_ID, TASTING_ID);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: TASTING_ID, userId: USER_ID },
      });
      expect(repo.delete).toHaveBeenCalledWith({
        id: TASTING_ID,
        userId: USER_ID,
      });
      expect(photos.remove).not.toHaveBeenCalled();
    });

    it('deletes the photo files with the tasting', async () => {
      repo.findOne!.mockResolvedValue(makeTasting({ photoId: OLD_PHOTO_ID }));
      repo.delete!.mockResolvedValue({ affected: 1 });
      await service.remove(USER_ID, TASTING_ID);
      expect(photos.remove).toHaveBeenCalledWith(OLD_PHOTO_ID);
    });

    it("404s when the tasting is not the user's", async () => {
      repo.findOne!.mockResolvedValue(null);
      await expect(service.remove(USER_ID, TASTING_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  describe('photos', () => {
    let jpeg: Buffer;
    beforeAll(async () => {
      jpeg = await sharp({
        create: { width: 64, height: 32, channels: 3, background: '#a33' },
      })
        .jpeg()
        .toBuffer();
    });

    /** findOwned returns `before` until `repo.update` changes it. */
    const rows = (before: TasteepTasting) => {
      let current = before;
      repo.findOne!.mockImplementation(() => Promise.resolve(current));
      repo.update!.mockImplementation(
        (_where: unknown, set: Partial<TasteepTasting>) => {
          current = { ...current, ...set };
          return Promise.resolve({ affected: 1 });
        },
      );
    };

    it('stores a new photo and returns signed URLs', async () => {
      rows(makeTasting());
      const result = await service.setPhoto(USER_ID, TASTING_ID, jpeg);

      const [photoId, processed] = photos.save.mock.calls[0] as [
        string,
        { full: Buffer; thumb: Buffer },
      ];
      expect(photoId).toMatch(/^[0-9a-f-]{36}$/);
      expect((await sharp(processed.full).metadata()).format).toBe('webp');
      expect(repo.update).toHaveBeenCalledWith(
        { id: TASTING_ID, userId: USER_ID },
        { photoId },
      );
      expect(result.photo_url).toContain(`/tasteep/photos/${photoId}/full?`);
      expect(result.photo_thumb_url).toContain(
        `/tasteep/photos/${photoId}/thumb?`,
      );
      expect(photos.remove).not.toHaveBeenCalled();
    });

    it('deletes the previous files only after pointing at the new ones', async () => {
      rows(makeTasting({ photoId: OLD_PHOTO_ID }));
      await service.setPhoto(USER_ID, TASTING_ID, jpeg);
      expect(photos.remove).toHaveBeenCalledWith(OLD_PHOTO_ID);
      expect(photos.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
        repo.update!.mock.invocationCallOrder[0],
      );
    });

    it('cleans up the new files when the row update fails', async () => {
      rows(makeTasting({ photoId: OLD_PHOTO_ID }));
      repo.update!.mockRejectedValue(new Error('db down'));
      await expect(service.setPhoto(USER_ID, TASTING_ID, jpeg)).rejects.toThrow(
        'db down',
      );
      const [photoId] = photos.save.mock.calls[0] as [string];
      expect(photos.remove).toHaveBeenCalledWith(photoId);
      expect(photos.remove).not.toHaveBeenCalledWith(OLD_PHOTO_ID);
    });

    it('400s on a file that is not an image, before touching storage', async () => {
      rows(makeTasting());
      await expect(
        service.setPhoto(USER_ID, TASTING_ID, Buffer.from('not an image')),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(photos.save).not.toHaveBeenCalled();
    });

    it("404s for another user's tasting", async () => {
      repo.findOne!.mockResolvedValue(null);
      await expect(
        service.setPhoto(USER_ID, TASTING_ID, jpeg),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(photos.save).not.toHaveBeenCalled();
    });

    it('removePhoto clears the column, then deletes the files', async () => {
      rows(makeTasting({ photoId: OLD_PHOTO_ID }));
      const result = await service.removePhoto(USER_ID, TASTING_ID);
      expect(repo.update).toHaveBeenCalledWith(
        { id: TASTING_ID, userId: USER_ID },
        { photoId: null },
      );
      expect(photos.remove).toHaveBeenCalledWith(OLD_PHOTO_ID);
      expect(result.photo_url).toBeNull();
    });

    it('removePhoto is a no-op without a photo', async () => {
      rows(makeTasting());
      await service.removePhoto(USER_ID, TASTING_ID);
      expect(repo.update).not.toHaveBeenCalled();
      expect(photos.remove).not.toHaveBeenCalled();
    });

    it('upsert and updateLocation never write photo_id back', async () => {
      // A PUT racing an upload must not restore the id it loaded.
      repo.findOne!.mockResolvedValue(makeTasting({ photoId: OLD_PHOTO_ID }));
      repo.save!.mockImplementation((t: TasteepTasting) => Promise.resolve(t));
      await service.upsert(USER_ID, TASTING_ID, makeUpsertDto());
      await service.updateLocation(USER_ID, TASTING_ID, {
        lat: 1,
        lon: 2,
        precision: 'manual',
      });
      for (const [saved] of repo.save!.mock.calls as [TasteepTasting][]) {
        expect(saved.photoId).toBeUndefined();
      }
    });
  });

  describe('updateLocation', () => {
    const setup = (row: TasteepTasting) => {
      repo.findOne!.mockResolvedValue(row);
      repo.save!.mockImplementation(async (t: TasteepTasting) => t);
    };

    it('saves a manual pin', async () => {
      setup(makeTasting());
      const result = await service.updateLocation(USER_ID, TASTING_ID, {
        lat: 55.6,
        lon: -6.1,
        precision: 'manual',
      });
      expect(result).toMatchObject({
        lat: 55.6,
        lon: -6.1,
        location_precision: 'manual',
      });
    });

    it('refuses an automated result over a manual pin', async () => {
      setup(makeTasting({ lat: 55.6, lon: -6.1, locationPrecision: 'manual' }));
      await expect(
        service.updateLocation(USER_ID, TASTING_ID, {
          lat: 1,
          lon: 2,
          precision: 'exact',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('accepts an automated result when the tasting is not pinned', async () => {
      setup(makeTasting({ locationPrecision: 'country', lat: 56, lon: -4 }));
      const result = await service.updateLocation(USER_ID, TASTING_ID, {
        lat: 55.6,
        lon: -6.1,
        precision: 'region',
      });
      expect(result.location_precision).toBe('region');
    });

    it('clears coordinates with precision unknown, even over a manual pin', async () => {
      setup(makeTasting({ lat: 55.6, lon: -6.1, locationPrecision: 'manual' }));
      const result = await service.updateLocation(USER_ID, TASTING_ID, {
        precision: 'unknown',
      });
      expect(result).toMatchObject({
        lat: null,
        lon: null,
        location_precision: 'unknown',
      });
    });

    it('requires lat/lon for anything but unknown', async () => {
      setup(makeTasting());
      await expect(
        service.updateLocation(USER_ID, TASTING_ID, { precision: 'manual' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('404s for a tasting owned by someone else', async () => {
      repo.findOne!.mockResolvedValue(null);
      await expect(
        service.updateLocation(USER_ID, TASTING_ID, {
          lat: 1,
          lon: 2,
          precision: 'manual',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('stats', () => {
    it('parses the raw aggregate row into numbers', async () => {
      const qb = createMockQueryBuilder({
        count: '12',
        avg_score: '84.6666',
        distinct_distilleries: '7',
      });
      repo.createQueryBuilder!.mockReturnValue(qb);
      expect(await service.stats(USER_ID)).toEqual({
        count: 12,
        avg_score: 84.7,
        distinct_distilleries: 7,
      });
      expect(qb.where).toHaveBeenCalledWith('t.userId = :userId', {
        userId: USER_ID,
      });
    });

    it('returns zeros and a null average for an empty journal', async () => {
      repo.createQueryBuilder!.mockReturnValue(
        createMockQueryBuilder({
          count: '0',
          avg_score: null,
          distinct_distilleries: '0',
        }),
      );
      expect(await service.stats(USER_ID)).toEqual({
        count: 0,
        avg_score: null,
        distinct_distilleries: 0,
      });
    });
  });
});
