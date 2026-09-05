import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { TastingsService } from './tastings.service';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import {
  createMockQueryBuilder,
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';
import {
  makeTasting,
  makeUpsertDto,
  OTHER_USER_ID,
  TASTING_ID,
  USER_ID,
} from '../test-utils/fixtures';

describe('TastingsService', () => {
  let service: TastingsService;
  let repo: MockRepository<TasteepTasting>;

  beforeEach(async () => {
    repo = createMockRepository<TasteepTasting>();
    const module = await Test.createTestingModule({
      providers: [
        TastingsService,
        { provide: getRepositoryToken(TasteepTasting), useValue: repo },
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
        order: {
          dateTasted: { direction: 'DESC', nulls: 'LAST' },
          createdAt: 'DESC',
        },
      });
      expect(result[0].id).toBe(TASTING_ID);
      expect(result[0].date_tasted).toBe('2026-03-10T19:00:00.000Z');
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

  describe('remove', () => {
    it('deletes only within the user scope', async () => {
      repo.delete!.mockResolvedValue({ affected: 1 });
      await service.remove(USER_ID, TASTING_ID);
      expect(repo.delete).toHaveBeenCalledWith({
        id: TASTING_ID,
        userId: USER_ID,
      });
    });

    it('404s when nothing was deleted', async () => {
      repo.delete!.mockResolvedValue({ affected: 0 });
      await expect(service.remove(USER_ID, TASTING_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
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
      ).rejects.toBeInstanceOf(ConflictException);
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

  describe('cabinet', () => {
    it('groups by distillery and keeps a null group', async () => {
      repo.createQueryBuilder!.mockReturnValue(
        createMockQueryBuilder(undefined, [
          { distillery: 'Lagavulin', count: '3', avg_score: '88.25' },
          { distillery: null, count: '1', avg_score: null },
        ]),
      );
      expect(await service.cabinet(USER_ID)).toEqual([
        { distillery: 'Lagavulin', count: 3, avg_score: 88.3 },
        { distillery: null, count: 1, avg_score: null },
      ]);
    });
  });
});
