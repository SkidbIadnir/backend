import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import {
  bestMatch,
  DistilleryLocationsService,
  matchesName,
  seedRows,
  toSeedFile,
  type DistillerySeedFile,
} from './distillery-locations.service';
import { TasteepDistilleryLocation } from '../entities/tasteep-distillery-location.entity';
import { TasteepGeocodeCache } from '../entities/tasteep-geocode-cache.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';
import { makeDistilleryLocation } from '../test-utils/fixtures';
import * as distilleryData from '../data/distillery-location.json';

describe('seedRows', () => {
  it('builds a row per distillery with a stable slug id', () => {
    const rows = seedRows({
      distilleries: [
        { name: 'Ardbeg', lat: 55.64, lon: -6.11, precision: 'exact' },
        { name: 'Glen Scotia', lat: 55.42, lon: -5.6, precision: 'exact' },
      ],
    });
    expect(rows).toEqual([
      {
        id: 'ardbeg',
        name: 'Ardbeg',
        lat: 55.64,
        lon: -6.11,
        precision: 'exact',
      },
      {
        id: 'glen-scotia',
        name: 'Glen Scotia',
        lat: 55.42,
        lon: -5.6,
        precision: 'exact',
      },
    ]);
  });

  it('the real seed file has unique ids and valid coordinates', () => {
    const rows = seedRows(distilleryData as DistillerySeedFile);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of rows) {
      expect(typeof r.lat).toBe('number');
      expect(typeof r.lon).toBe('number');
      expect(Math.abs(r.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(r.lon)).toBeLessThanOrEqual(180);
    }
    expect(ids).toEqual(expect.arrayContaining(['ardbeg']));
  });

  it('uses an explicit id over the slug (a row renamed after creation)', () => {
    const [row] = seedRows({
      distilleries: [
        {
          id: 'jura',
          name: 'Isle of Jura',
          lat: 1,
          lon: 2,
          precision: 'exact',
        },
      ],
    });
    expect(row.id).toBe('jura');
  });
});

describe('matchesName / bestMatch', () => {
  it('matches the exact name or the name followed by a separator', () => {
    expect(matchesName('ardbeg', 'Ardbeg')).toBe(true);
    expect(matchesName('ardbeg · islay', 'Ardbeg')).toBe(true);
    expect(matchesName('ardbeg, islay', 'Ardbeg')).toBe(true);
    expect(matchesName('ardbegxyz', 'Ardbeg')).toBe(false);
    expect(matchesName('glen scotia', 'Glen')).toBe(true);
  });

  it('prefers the longest matching name, whatever the row order', () => {
    const glen = makeDistilleryLocation({ id: 'glen', name: 'Glen' });
    const scotia = makeDistilleryLocation({
      id: 'glen-scotia',
      name: 'Glen Scotia',
    });
    expect(bestMatch('glen scotia, campbeltown', [glen, scotia])?.id).toBe(
      'glen-scotia',
    );
    expect(bestMatch('glen scotia', [scotia, glen])?.id).toBe('glen-scotia');
    expect(bestMatch('glen moray', [scotia, glen])?.id).toBe('glen');
  });
});

describe('toSeedFile', () => {
  it('round-trips the real seed file, comment and notes included', () => {
    const file = distilleryData as DistillerySeedFile;
    const rows = seedRows(file).map((r) => makeDistilleryLocation(r));
    expect(toSeedFile(rows, file)).toEqual({
      _comment: file._comment,
      distilleries: [...file.distilleries].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    });
  });

  it('writes the id when a rename made it differ from the slug', () => {
    const file = toSeedFile(
      [makeDistilleryLocation({ id: 'jura', name: 'Isle of Jura' })],
      { distilleries: [] },
    );
    expect(file.distilleries[0]).toMatchObject({
      id: 'jura',
      name: 'Isle of Jura',
    });
  });
});

describe('DistilleryLocationsService', () => {
  let service: DistilleryLocationsService;
  let repo: MockRepository<TasteepDistilleryLocation>;
  let insertQb: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = createMockRepository<TasteepDistilleryLocation>();
    insertQb = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };
    repo.createQueryBuilder!.mockReturnValue(insertQb);
    const module = await Test.createTestingModule({
      providers: [
        DistilleryLocationsService,
        {
          provide: getRepositoryToken(TasteepDistilleryLocation),
          useValue: repo,
        },
        {
          provide: getRepositoryToken(TasteepGeocodeCache),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(TasteepTasting),
          useValue: createMockRepository(),
        },
      ],
    }).compile();
    service = module.get(DistilleryLocationsService);
  });

  describe('seed', () => {
    it('inserts only ids the table lacks, soft-deleted ones included', async () => {
      repo.find!.mockResolvedValue([{ id: 'ardbeg' }]);
      const n = await service.seed({
        distilleries: [
          { name: 'Ardbeg', lat: 1, lon: 2, precision: 'exact' },
          { name: 'Jura', lat: 3, lon: 4, precision: 'exact' },
        ],
      });
      expect(n).toBe(1);
      expect(repo.find).toHaveBeenCalledWith({
        select: { id: true },
        withDeleted: true,
      });
      expect(insertQb.values).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'jura', name: 'Jura' }),
      ]);
      expect(insertQb.orIgnore).toHaveBeenCalled();
    });

    it('inserts nothing when every id is present', async () => {
      repo.find!.mockResolvedValue([{ id: 'ardbeg' }]);
      await service.seed({
        distilleries: [{ name: 'Ardbeg', lat: 1, lon: 2, precision: 'exact' }],
      });
      expect(insertQb.insert).not.toHaveBeenCalled();
    });
  });

  describe('match', () => {
    beforeEach(() => {
      repo.find!.mockResolvedValue([makeDistilleryLocation()]);
    });

    it('matches the distillery name alone', async () => {
      expect((await service.match('ardbeg'))?.id).toBe('ardbeg');
    });

    it('matches with a "·"-separated region suffix', async () => {
      expect((await service.match('ardbeg · islay'))?.id).toBe('ardbeg');
    });

    it('matches with a comma-separated region suffix', async () => {
      expect((await service.match('ardbeg, islay'))?.id).toBe('ardbeg');
    });

    it('does not match a different word that merely starts with the same letters', async () => {
      expect(await service.match('ardbegxyz')).toBeNull();
    });

    it('returns null for a name not in the table', async () => {
      expect(await service.match('glenfiddich')).toBeNull();
    });
  });

  describe('create', () => {
    it('409s when the slug is live', async () => {
      repo.findOne!.mockResolvedValue(makeDistilleryLocation());
      await expect(
        service.create({ name: 'Ardbeg', lat: 1, lon: 2, precision: 'exact' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'ardbeg' },
        withDeleted: true,
      });
    });
  });
});
