import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import {
  normalizeName,
  RegionsService,
  renamedAliases,
  seedRows,
  slugify,
  toSeedFile,
} from './regions.service';
import { TasteepRegion } from '../entities/tasteep-region.entity';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
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

  it('seedRows takes explicit ids and aliases', () => {
    const rows = seedRows({
      regions: [
        {
          id: 'usa',
          main: 'United States',
          lat: 1,
          lon: 2,
          aliases: ['USA'],
          sub: [{ id: 'usa/ky', name: 'Kentucky', lat: 3, lon: 4 }],
        },
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({ id: 'usa', aliases: ['USA'] }),
      expect.objectContaining({ id: 'usa/ky', parentId: 'usa', aliases: [] }),
    ]);
  });

  it('toSeedFile round-trips the real seed file', () => {
    const file = regionData as RegionSeedFile;
    const rows = seedRows(file).map((r) => makeRegion(r));
    expect(toSeedFile(rows, file)).toEqual({
      _comment: file._comment,
      regions: file.regions,
    });
  });

  it('toSeedFile writes the id when a rename made it differ from the name', () => {
    const file = toSeedFile(
      [
        makeRegion({ id: 'scotland', name: 'Alba', parentId: null }),
        makeRegion({ id: 'scotland/islay', name: 'Ile', parentId: 'scotland' }),
      ],
      { regions: [] },
    );
    expect(file.regions[0]).toMatchObject({ id: 'scotland', main: 'Alba' });
    expect(file.regions[0].sub[0]).toMatchObject({
      id: 'scotland/islay',
      name: 'Ile',
    });
  });

  it('renamedAliases keeps the old name and drops the new one', () => {
    expect(renamedAliases(['Highlands'], 'Highland', 'Highlands')).toEqual([
      'Highland',
    ]);
    expect(renamedAliases([], 'Islay', 'ISLAY')).toEqual([]);
    expect(renamedAliases(['islay'], 'Islay', 'Isle of Islay')).toEqual([
      'islay',
    ]);
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
        {
          provide: getRepositoryToken(TasteepTasting),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(TasteepSmwsCode),
          useValue: createMockRepository(),
        },
      ],
    }).compile();
    service = module.get(RegionsService);
  });

  describe('seed', () => {
    let insertQb: Record<string, jest.Mock>;
    beforeEach(() => {
      insertQb = {
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      };
      repo.createQueryBuilder!.mockReturnValue(insertQb);
    });

    it('inserts missing parents before missing children', async () => {
      repo.find!.mockResolvedValue([]);
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
      expect(repo.find).toHaveBeenCalledWith({ withDeleted: true });
      expect(insertQb.values.mock.calls).toEqual([
        [[expect.objectContaining({ id: 'scotland', parentId: null })]],
        [
          [
            expect.objectContaining({
              id: 'scotland/islay',
              parentId: 'scotland',
            }),
          ],
        ],
      ]);
    });

    it('leaves existing and soft-deleted rows alone, and the children of a deleted country', async () => {
      repo.find!.mockResolvedValue([
        makeRegion({
          id: 'scotland',
          parentId: null,
          deletedAt: new Date(),
          aliases: [],
        }),
        makeRegion({ id: 'sweden', parentId: null, aliases: ['Sverige'] }),
      ]);
      const n = await service.seed({
        regions: [
          {
            main: 'Scotland',
            lat: 1,
            lon: 2,
            sub: [{ name: 'Islay', lat: 3, lon: 4 }],
          },
          { main: 'Sweden', lat: 1, lon: 2, sub: [] },
        ],
      });
      expect(n).toBe(0);
      expect(insertQb.insert).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('fills aliases that were never set', async () => {
      repo.find!.mockResolvedValue([
        makeRegion({ id: 'united-states', parentId: null, aliases: null }),
      ]);
      await service.seed({
        regions: [
          {
            main: 'United States',
            lat: 1,
            lon: 2,
            aliases: ['USA'],
            sub: [],
          },
        ],
      });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'united-states', aliases: IsNull() },
        { aliases: ['USA'] },
      );
    });
  });

  describe('tree', () => {
    it('nests subregions under their country in seed order', async () => {
      repo.find!.mockResolvedValue(makeRegionRows());
      const tree = await service.tree();
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
        withDeleted: true,
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

    it('matches aliases stored on the rows', async () => {
      repo.find!.mockResolvedValue([
        ...makeRegionRows(),
        makeRegion({
          id: 'scotland/highland',
          name: 'Highland',
          aliases: ['Highlands'],
        }),
        makeRegion({
          id: 'united-states',
          name: 'United States',
          parentId: null,
          aliases: ['USA', 'US'],
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

  describe('create', () => {
    it('builds a subregion id under a live country', async () => {
      repo
        .findOne!.mockResolvedValueOnce(
          makeRegion({ id: 'scotland', parentId: null }),
        )
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          makeRegion({ id: 'scotland/arran', name: 'Arran' }),
        );
      repo.createQueryBuilder!.mockReturnValue({
        withDeleted: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ max: 6 }),
      });
      const row = await service.create({
        name: 'Arran',
        parent_id: 'scotland',
      });
      expect(row.id).toBe('scotland/arran');
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'scotland/arran',
          parentId: 'scotland',
          sortOrder: 7,
          aliases: [],
          deletedAt: null,
        }),
      );
    });

    it('refuses a subregion of a subregion', async () => {
      repo.findOne!.mockResolvedValueOnce(makeRegion());
      await expect(
        service.create({ name: 'Port Ellen', parent_id: 'scotland/islay' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('409s when the id is live', async () => {
      repo.findOne!.mockResolvedValueOnce(
        makeRegion({ id: 'sweden', parentId: null }),
      );
      await expect(service.create({ name: 'Sweden' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('keeps the old name as an alias on rename', async () => {
      repo.findOne!.mockResolvedValue(makeRegion());
      await service.update('scotland/islay', { name: 'Isle of Islay' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Isle of Islay', aliases: ['Islay'] }),
      );
    });
  });

  describe('reorder', () => {
    beforeEach(() =>
      repo.find!.mockResolvedValue(
        makeRegionRows().filter((r) => r.parentId === null),
      ),
    );

    it('400s unless ids lists every live sibling once', async () => {
      for (const ids of [['scotland'], ['scotland', 'sweden', 'sweden']]) {
        await expect(
          service.reorder({ parent_id: null, ids }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('writes sort_order from the position', async () => {
      const em = { update: jest.fn() };
      repo.manager = {
        transaction: jest.fn((fn: (m: typeof em) => unknown) => fn(em)),
      } as never;
      jest.spyOn(service, 'adminTree').mockResolvedValue([]);
      await service.reorder({ parent_id: null, ids: ['sweden', 'scotland'] });
      expect(em.update.mock.calls).toEqual([
        [TasteepRegion, { id: 'sweden' }, { sortOrder: 0 }],
        [TasteepRegion, { id: 'scotland' }, { sortOrder: 1 }],
      ]);
    });
  });
});
