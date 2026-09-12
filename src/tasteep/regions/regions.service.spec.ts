import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import {
  normalizeName,
  RegionsService,
  seedRows,
  slugify,
} from './regions.service';
import { TasteepRegion } from '../entities/tasteep-region.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';
import { makeRegion, makeRegionRows } from '../test-utils/fixtures';
import * as regionData from '../data/region.json';
import type { RegionSeedFile } from './regions.service';

describe('regions helpers', () => {
  it('slugify strips diacritics and punctuation', () => {
    expect(slugify('Cork County')).toBe('cork-county');
    expect(slugify('Newfoundland and Labrador')).toBe(
      'newfoundland-and-labrador',
    );
    expect(slugify('Québec ')).toBe('quebec');
    expect(slugify('U.S.A.')).toBe('u-s-a');
  });

  it('normalizeName is case/whitespace/diacritic-insensitive', () => {
    expect(normalizeName('  ISLAY ')).toBe('islay');
    expect(normalizeName('Cork   County')).toBe('cork county');
    expect(normalizeName('Québec')).toBe('quebec');
  });

  it('seedRows emits parents then children with stable slug ids', () => {
    const rows = seedRows({
      regions: [
        {
          main: 'Scotland',
          lat: 56.49,
          lon: -4.2,
          sub: [{ name: 'Speyside', lat: 57.45, lon: -3.15 }],
        },
        { main: 'Sweden', lat: 62, lon: 15, sub: [] },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual([
      'scotland',
      'scotland/speyside',
      'sweden',
    ]);
    expect(rows[1]).toMatchObject({
      name: 'Speyside',
      parentId: 'scotland',
      lat: 57.45,
      lon: -3.15,
      sortOrder: 0,
    });
    expect(rows[2]).toMatchObject({ parentId: null, sortOrder: 1 });
  });

  it('the real seed file has unique ids and a centroid on every row', () => {
    const rows = seedRows(regionData as RegionSeedFile);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of rows) {
      expect(typeof r.lat).toBe('number');
      expect(typeof r.lon).toBe('number');
      expect(Math.abs(r.lat!)).toBeLessThanOrEqual(90);
      expect(Math.abs(r.lon!)).toBeLessThanOrEqual(180);
    }
    expect(ids).toEqual(
      expect.arrayContaining([
        'scotland',
        'scotland/islay',
        'scotland/campbeltown',
        'united-states/kentucky',
        'taiwan/yilan',
      ]),
    );
  });
});

describe('RegionsService', () => {
  let service: RegionsService;
  let repo: MockRepository<TasteepRegion>;

  beforeEach(async () => {
    repo = createMockRepository<TasteepRegion>();
    const module = await Test.createTestingModule({
      providers: [
        RegionsService,
        { provide: getRepositoryToken(TasteepRegion), useValue: repo },
      ],
    }).compile();
    service = module.get(RegionsService);
  });

  describe('seed', () => {
    it('upserts parents before children, keyed on id', async () => {
      repo.upsert!.mockResolvedValue(undefined);
      const n = await service.seed({
        regions: [
          {
            main: 'Scotland',
            lat: 1,
            lon: 2,
            sub: [{ name: 'Islay', lat: 3, lon: 4 }],
          },
        ],
      });
      expect(n).toBe(2);
      expect(repo.upsert).toHaveBeenCalledTimes(2);
      const calls = repo.upsert!.mock.calls as [TasteepRegion[], string[]][];
      expect(calls[0][0]).toEqual([
        expect.objectContaining({ id: 'scotland', parentId: null }),
      ]);
      expect(calls[0][1]).toEqual(['id']);
      expect(calls[1][0]).toEqual([
        expect.objectContaining({ id: 'scotland/islay', parentId: 'scotland' }),
      ]);
    });

    it('skips the child upsert when there are none', async () => {
      repo.upsert!.mockResolvedValue(undefined);
      await service.seed({
        regions: [{ main: 'Sweden', lat: 1, lon: 2, sub: [] }],
      });
      expect(repo.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('tree', () => {
    it('nests subregions under their country in seed order', async () => {
      repo.find!.mockResolvedValue(makeRegionRows());
      const tree = await service.tree();
      expect(repo.find).toHaveBeenCalledWith({
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
      expect(tree).toEqual([
        {
          id: 'scotland',
          name: 'Scotland',
          lat: 56.49,
          lon: -4.2,
          subregions: [
            {
              id: 'scotland/speyside',
              name: 'Speyside',
              lat: 57.45,
              lon: -3.15,
            },
            { id: 'scotland/islay', name: 'Islay', lat: 55.78, lon: -6.25 },
          ],
        },
        { id: 'sweden', name: 'Sweden', lat: 62, lon: 15, subregions: [] },
      ]);
    });
  });

  describe('resolve', () => {
    beforeEach(() => repo.find!.mockResolvedValue(makeRegionRows()));

    it('returns the picked row when region_id is given', async () => {
      repo.findOne!.mockResolvedValue(makeRegion());
      const row = await service.resolve('scotland/islay', 'whatever');
      expect(row?.id).toBe('scotland/islay');
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'scotland/islay' },
      });
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('400s on an unknown region_id', async () => {
      repo.findOne!.mockResolvedValue(null);
      await expect(service.resolve('atlantis', null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('matches free text by name, case-insensitively', async () => {
      expect((await service.resolve(null, '  islay '))?.id).toBe(
        'scotland/islay',
      );
      expect((await service.resolve(undefined, 'SWEDEN'))?.id).toBe('sweden');
    });

    it('prefers the subregion when text names both country and subregion', async () => {
      expect((await service.resolve(null, 'Scotland / Speyside'))?.id).toBe(
        'scotland/speyside',
      );
      expect((await service.resolve(null, 'Islay, Scotland'))?.id).toBe(
        'scotland/islay',
      );
    });

    it('knows a few common aliases', async () => {
      repo.find!.mockResolvedValue([
        ...makeRegionRows(),
        makeRegion({ id: 'scotland/highland', name: 'Highland' }),
        makeRegion({
          id: 'united-states',
          name: 'United States',
          parentId: null,
        }),
      ]);
      expect((await service.resolve(null, 'Highlands'))?.id).toBe(
        'scotland/highland',
      );
      expect((await service.resolve(null, 'USA'))?.id).toBe('united-states');
    });

    it('returns null for empty or unmatched text', async () => {
      expect(await service.resolve(null, null)).toBeNull();
      expect(await service.resolve(null, '   ')).toBeNull();
      expect(await service.resolve(null, "Grandma's cellar")).toBeNull();
    });
  });
});
