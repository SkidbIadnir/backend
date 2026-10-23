import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import { RegionsService } from '../regions/regions.service';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';
import { makeRegion } from '../test-utils/fixtures';
import * as smwsCodeData from '../data/smws-codes.json';
import {
  seedRows,
  SmwsCodeSeedFile,
  SmwsCodesService,
  snapshotVersion,
  toSeedFile,
  toSmwsCodeJson,
} from './smws-codes.service';

const FILE = smwsCodeData as unknown as SmwsCodeSeedFile;

const SMALL: SmwsCodeSeedFile = {
  'single malt': {
    distilleries: [
      {
        distilleryName: 'Glenfarclas',
        smwsId: 1,
        region: 'Speyside',
        extra: null,
      },
      { distilleryName: 'Bowmore', smwsId: 3, region: 'Islay', extra: null },
    ],
  },
  'grain whisky': {
    distilleries: [
      {
        distilleryName: 'North British',
        smwsId: 'G1',
        region: 'Lowland',
        extra: null,
      },
    ],
  },
};

/** What a row loaded from Postgres looks like for a seed row. */
const asRow = (
  r: ReturnType<typeof seedRows>[number],
  overrides: Partial<TasteepSmwsCode> = {},
): TasteepSmwsCode => ({
  ...r,
  regionRef: null,
  regionId: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  deletedAt: null,
  ...overrides,
});

describe('smws-codes helpers', () => {
  it('seedRows flattens categories in file order with string codes', () => {
    const rows = seedRows(SMALL);
    expect(rows.map((r) => [r.code, r.category, r.sortOrder])).toEqual([
      ['1', 'single malt', 0],
      ['3', 'single malt', 1],
      ['G1', 'grain whisky', 2],
    ]);
  });

  it('the real seed file has 240 codes, all unique', () => {
    const codes = seedRows(FILE).map((r) => r.code);
    expect(codes).toHaveLength(240);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('toSeedFile round-trips the real seed file exactly', () => {
    const rows = seedRows(FILE).map((r) => asRow(r));
    // JSON imports carry a `default` key under esModuleInterop; compare data only.
    const expected = JSON.parse(JSON.stringify(FILE)) as Record<
      string,
      unknown
    >;
    delete expected.default;
    expect(toSeedFile(rows.reverse())).toEqual(expected);
  });

  it('snapshotVersion is stable and changes with content', () => {
    const items = seedRows(SMALL).map((r) => toSmwsCodeJson(asRow(r)));
    const v = snapshotVersion(items);
    expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotVersion(items.map((i) => ({ ...i })))).toBe(v);
    expect(
      snapshotVersion([{ ...items[0], extra: 'Closed' }, ...items.slice(1)]),
    ).not.toBe(v);
  });
});

describe('SmwsCodesService', () => {
  let service: SmwsCodesService;
  let repo: MockRepository<TasteepSmwsCode>;
  let regions: { resolve: jest.Mock };
  let insertQb: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = createMockRepository<TasteepSmwsCode>();
    repo.softDelete = jest.fn();
    repo.restore = jest.fn();
    insertQb = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };
    repo.createQueryBuilder!.mockReturnValue(insertQb);
    regions = {
      resolve: jest.fn((id: string | null, text: string | null) => {
        if (id === 'nowhere') throw new Error('400');
        if (id) return makeRegion({ id });
        return text === 'Islay'
          ? makeRegion({ id: 'scotland/islay', name: 'Islay' })
          : null;
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SmwsCodesService,
        { provide: getRepositoryToken(TasteepSmwsCode), useValue: repo },
        { provide: RegionsService, useValue: regions },
      ],
    }).compile();
    service = moduleRef.get(SmwsCodesService);
  });

  describe('seed', () => {
    it('inserts only codes the table lacks, deleted ones counting as present', async () => {
      repo.find!.mockResolvedValue([{ code: '1' }, { code: 'G1' }]);
      await expect(service.seed(SMALL)).resolves.toBe(1);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ withDeleted: true }),
      );
      expect(insertQb.values).toHaveBeenCalledWith([
        expect.objectContaining({
          code: '3',
          distilleryName: 'Bowmore',
          regionId: 'scotland/islay',
          sortOrder: 1,
        }),
      ]);
      expect(insertQb.orIgnore).toHaveBeenCalled();
    });

    it('does nothing when every code is present', async () => {
      repo.find!.mockResolvedValue(seedRows(SMALL));
      await expect(service.seed(SMALL)).resolves.toBe(0);
      expect(insertQb.execute).not.toHaveBeenCalled();
    });
  });

  it('snapshot orders by sort_order and hashes the items', async () => {
    const [a, b, c] = seedRows(SMALL).map((r) => asRow(r));
    repo.find!.mockResolvedValue([c, a, b]);
    const snap = await service.snapshot();
    expect(snap.items.map((i) => i.code)).toEqual(['1', '3', 'G1']);
    expect(snap.version).toBe(snapshotVersion(snap.items));
  });

  describe('diff', () => {
    it('reports each kind of drift', async () => {
      const [glenfarclas, bowmore, northBritish] = seedRows(SMALL);
      repo.find!.mockResolvedValue([
        asRow(glenfarclas, { extra: 'Family owned' }),
        asRow(northBritish, { deletedAt: new Date() }),
        asRow({ ...bowmore, code: '999', sortOrder: 9 }),
      ]);
      await expect(service.diff(SMALL)).resolves.toEqual({
        in_sync: false,
        only_in_json: ['3'],
        only_in_table: ['999'],
        deleted_in_table: ['G1'],
        changed: [
          {
            code: '1',
            fields: [{ field: 'extra', json: null, table: 'Family owned' }],
          },
        ],
      });
    });

    it('is in sync when the table mirrors the file', async () => {
      repo.find!.mockResolvedValue(seedRows(SMALL).map((r) => asRow(r)));
      await expect(service.diff(SMALL)).resolves.toMatchObject({
        in_sync: true,
      });
    });
  });

  describe('create', () => {
    it('409s a live code', async () => {
      repo.findOne!.mockResolvedValue(asRow(seedRows(SMALL)[0]));
      await expect(
        service.create({
          code: '1',
          distillery_name: 'X',
          category: 'single malt',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('revives a soft-deleted code in place, keeping its sort order', async () => {
      const deleted = asRow(seedRows(SMALL)[1], { deletedAt: new Date() });
      const revived = asRow(seedRows(SMALL)[1]);
      repo
        .findOne!.mockResolvedValueOnce(deleted)
        .mockResolvedValueOnce(revived);
      await service.create({
        code: '3',
        distillery_name: 'Bowmore',
        category: 'single malt',
        region: 'Islay',
      });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          code: '3',
          sortOrder: 1,
          regionId: 'scotland/islay',
          deletedAt: null,
        }),
      );
    });
  });

  describe('update', () => {
    it('re-resolves region_id when only region text changes', async () => {
      const row = asRow(seedRows(SMALL)[0], { regionId: 'scotland/speyside' });
      repo.findOne!.mockResolvedValue(row);
      await service.update('1', { region: 'Islay' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'Islay',
          regionId: 'scotland/islay',
        }),
      );
    });

    it('an explicit region_id wins over the text, and null unlinks', async () => {
      repo.findOne!.mockResolvedValue(asRow(seedRows(SMALL)[0]));
      await service.update('1', { region: 'Islay', region_id: 'japan' });
      expect(repo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ regionId: 'japan' }),
      );

      repo.findOne!.mockResolvedValue(
        asRow(seedRows(SMALL)[0], { regionId: 'japan' }),
      );
      await service.update('1', { region_id: null });
      expect(repo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ regionId: null, region: 'Speyside' }),
      );
    });

    it('404s an unknown or deleted code', async () => {
      repo.findOne!.mockResolvedValue(null);
      await expect(service.update('nope', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  it('remove soft-deletes a live code', async () => {
    repo.findOne!.mockResolvedValue(asRow(seedRows(SMALL)[0]));
    await service.remove('1');
    expect(repo.softDelete).toHaveBeenCalledWith({ code: '1' });
  });
});
