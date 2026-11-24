import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { FlavoursService } from './flavours.service';
import { TasteepFlavour } from '../entities/tasteep-flavour.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';

const flavour = (
  over: Partial<TasteepFlavour> & { id: string },
): TasteepFlavour =>
  ({
    nameEn: over.id,
    nameFr: over.id,
    parentId: null,
    sortOrder: 0,
    aliases: [],
    deletedAt: null,
    ...over,
  }) as TasteepFlavour;

const SMOKY = flavour({ id: 'smoky', nameEn: 'Smoky', nameFr: 'Fumé' });
const PEAT = flavour({
  id: 'smoky/peat',
  nameEn: 'Peat',
  nameFr: 'Tourbe',
  parentId: 'smoky',
  aliases: ['peaty'],
});

describe('FlavoursService', () => {
  let service: FlavoursService;
  let repo: MockRepository<TasteepFlavour>;
  let tastingRepo: MockRepository<TasteepTasting> & { query: jest.Mock };
  let insert: { values: jest.Mock };

  beforeEach(async () => {
    repo = createMockRepository<TasteepFlavour>();
    tastingRepo = {
      ...createMockRepository<TasteepTasting>(),
      query: jest.fn(),
    };
    insert = { values: jest.fn() };
    const insertQb = {
      insert: jest.fn().mockReturnThis(),
      values: insert.values.mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };
    repo.createQueryBuilder!.mockReturnValue(insertQb);
    repo.find!.mockResolvedValue([SMOKY, PEAT]);
    repo.save!.mockImplementation(async (r: TasteepFlavour) => r);

    const moduleRef = await Test.createTestingModule({
      providers: [
        FlavoursService,
        { provide: getRepositoryToken(TasteepFlavour), useValue: repo },
        { provide: getRepositoryToken(TasteepTasting), useValue: tastingRepo },
      ],
    }).compile();
    service = moduleRef.get(FlavoursService);
  });

  describe('seed', () => {
    it('inserts missing ids, categories first, and adds new aliases to live rows', async () => {
      repo.find!.mockResolvedValue([
        flavour({
          id: 'smoky',
          nameEn: 'Smoky',
          nameFr: 'Fumé',
          aliases: ['smoke'],
        }),
      ]);
      const changed = await service.seed({
        flavours: [
          {
            name_en: 'Smoky',
            name_fr: 'Fumé',
            aliases: ['smoke', 'smokey'],
            sub: [{ name_en: 'Peat', name_fr: 'Tourbe' }],
          },
          { name_en: 'Sweet', name_fr: 'Sucré' },
        ],
      });

      expect(
        (insert.values.mock.calls as [{ id: string }[]][]).map((c) =>
          c[0].map((r) => r.id),
        ),
      ).toEqual([['sweet'], ['smoky/peat']]);
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'smoky' },
        { aliases: ['smoke', 'smokey'] },
      );
      expect(changed).toBe(3);
    });

    it('leaves deleted rows and their children out, and reports no change when in sync', async () => {
      repo.find!.mockResolvedValue([
        flavour({ id: 'smoky', deletedAt: new Date() }),
      ]);
      const changed = await service.seed({
        flavours: [
          {
            name_en: 'Smoky',
            name_fr: 'Fumé',
            aliases: ['smoke'],
            sub: [{ name_en: 'Peat', name_fr: 'Tourbe' }],
          },
        ],
      });
      expect(insert.values).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(changed).toBe(0);
    });
  });

  it('resolve matches against live rows, and skips the lookup for no tags', async () => {
    await expect(service.resolve(['Peaty', 'fumé', 'wax'])).resolves.toEqual([
      'smoky/peat',
      'smoky',
    ]);
    repo.find!.mockClear();
    await expect(service.resolve([])).resolves.toEqual([]);
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('tree nests flavours under their category', async () => {
    await expect(service.tree()).resolves.toEqual([
      {
        id: 'smoky',
        name_en: 'Smoky',
        name_fr: 'Fumé',
        children: [{ id: 'smoky/peat', name_en: 'Peat', name_fr: 'Tourbe' }],
      },
    ]);
  });

  describe('reindex', () => {
    it('writes only rows whose ids changed, guarded on the tags read', async () => {
      tastingRepo.query
        .mockResolvedValueOnce([
          { id: 'a', tags: ['peaty'], flavour_ids: ['smoky/peat'] },
          { id: 'b', tags: ['Fumé', 'x'], flavour_ids: [] },
          { id: 'c', tags: ['x'], flavour_ids: ['gone'] },
        ])
        .mockResolvedValueOnce([[], 2]);

      await expect(service.reindex()).resolves.toEqual({
        scanned: 3,
        updated: 2,
      });
      const [sql, [payload]] = tastingRepo.query.mock.calls[1] as [
        string,
        [string],
      ];
      expect(sql).toContain('to_jsonb(t.tags) = v.tags');
      expect(JSON.parse(payload)).toEqual([
        { id: 'b', tags: ['Fumé', 'x'], ids: ['smoky'] },
        { id: 'c', tags: ['x'], ids: [] },
      ]);
    });
  });

  describe('admin edits', () => {
    beforeEach(() => {
      tastingRepo.query.mockResolvedValue([]); // reindex: nothing tagged
    });

    it('create derives the id under a live category', async () => {
      repo
        .findOne!.mockResolvedValueOnce(SMOKY) // parent
        .mockResolvedValueOnce(null) // existing id
        .mockResolvedValueOnce(flavour({ id: 'smoky/tar' })); // findLive
      repo.createQueryBuilder!.mockReturnValue({
        withDeleted: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ max: 0 }),
      });

      await service.create({
        name_en: 'Tar',
        name_fr: 'Goudron',
        parent_id: 'smoky',
        aliases: ['tarry', 'Tar'],
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'smoky/tar',
          parentId: 'smoky',
          sortOrder: 1,
          aliases: ['tarry'],
          deletedAt: null,
        }),
      );
    });

    it('create refuses a flavour as parent', async () => {
      repo.findOne!.mockResolvedValueOnce(PEAT);
      await expect(
        service.create({ name_en: 'X', name_fr: 'X', parent_id: 'smoky/peat' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('addAlias 409s on a key another flavour answers to', async () => {
      repo.findOne!.mockResolvedValueOnce(flavour({ ...SMOKY }));
      await expect(service.addAlias('smoky', 'Peaty')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('addAlias is a no-op for a key the row already answers to', async () => {
      repo.findOne!.mockResolvedValue(flavour({ ...PEAT }));
      await service.addAlias('smoky/peat', 'TOURBE');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('update keeps the old name as an alias on a rename', async () => {
      repo.findOne!.mockResolvedValue(flavour({ ...PEAT }));
      await service.update('smoky/peat', { name_en: 'Peat smoke' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          nameEn: 'Peat smoke',
          aliases: ['peaty', 'Peat'],
        }),
      );
    });
  });
});
