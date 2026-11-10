import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createMockQueryBuilder,
  createMockRepository,
} from '../../test-utils/mock-repository.factory';
import { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import { SmwsBottlesService } from './smws-bottles.service';

const row = (over: Partial<TasteepSmwsBottle> = {}): TasteepSmwsBottle =>
  ({
    sku: '001234GX0700614',
    kind: 'single_cask',
    batch: null,
    stock: 12,
    inStock: true,
    releasedAt: new Date('2026-10-30T09:00:00Z'),
    distilledDate: '2012-01-25',
    categories: [],
    code: '1.234',
    distilleryCode: '1',
    smwsCode: { distilleryName: 'Glenfarclas', category: 'single malt' },
    caskNo: '234',
    name: 'A dram',
    url: 'https://smws.eu/1-234',
    priceText: '€95.00',
    priceAmount: 95,
    priceCurrency: 'EUR',
    abv: 58.3,
    age: '12 years',
    caskType: null,
    profile: null,
    regionText: 'Speyside',
    regionId: 'scotland/speyside',
    firstSeenAt: new Date('2026-11-01T00:00:00Z'),
    lastSeenAt: new Date('2026-11-09T00:00:00Z'),
    delistedAt: null,
    ...over,
  }) as TasteepSmwsBottle;

describe('SmwsBottlesService', () => {
  let bottles: ReturnType<typeof createMockRepository>;
  let runs: ReturnType<typeof createMockRepository>;
  let pages: ReturnType<typeof createMockRepository>;
  let qb: ReturnType<typeof createMockQueryBuilder>;
  let service: SmwsBottlesService;

  beforeEach(() => {
    qb = createMockQueryBuilder({
      total: '4',
      available: '2',
      single_casks: '2',
      blends: '1',
      without_region: '1',
      unknown_distillery: '0',
      last_seen_at: new Date('2026-11-09T00:00:00Z'),
    });
    for (const m of [
      'leftJoin',
      'leftJoinAndSelect',
      'setParameters',
      'offset',
      'limit',
    ]) {
      qb[m] = jest.fn().mockReturnValue(qb);
    }
    qb.getManyAndCount = jest.fn().mockResolvedValue([[row()], 1]);
    bottles = createMockRepository();
    bottles.createQueryBuilder!.mockReturnValue(qb);
    runs = createMockRepository();
    runs.find!.mockResolvedValue([]);
    pages = createMockRepository();
    pages.createQueryBuilder!.mockReturnValue(
      createMockQueryBuilder(undefined, [
        { kind: 'bottle', n: '3' },
        { kind: 'other', n: '5' },
      ]),
    );
    service = new SmwsBottlesService(
      bottles as never,
      runs as never,
      pages as never,
      { isRunning: () => false } as never,
    );
  });

  describe('list', () => {
    it('defaults to available bottles, newest release first, 50 per page', async () => {
      const page = await service.list();
      expect(qb.andWhere).toHaveBeenCalledWith('b.in_stock = true');
      expect(qb.addSelect).toHaveBeenCalledWith(
        '(b.released_at)',
        'sort_released',
      );
      expect(qb.addOrderBy).toHaveBeenCalledWith(
        'sort_released',
        'DESC',
        'NULLS LAST',
      );
      expect(qb.limit).toHaveBeenCalledWith(50);
      expect(page.total).toBe(1);
      expect(page.items[0]).toEqual(
        expect.objectContaining({
          sku: '001234GX0700614',
          kind: 'single_cask',
          code: '1.234',
          distillery_name: 'Glenfarclas',
          region_id: 'scotland/speyside',
          distilled_date: '2012-01-25',
          released_at: '2026-10-30T09:00:00.000Z',
          available: true,
          stock: 12,
          delisted_at: null,
        }),
      );
    });

    it('lists our archive by sell-out date and filters by kind, code and region', async () => {
      await service.list({
        status: 'delisted',
        kind: 'blend',
        distillery_code: 'g1',
        region_id: 'scotland',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('b.in_stock = false');
      expect(qb.andWhere).toHaveBeenCalledWith('b.kind = :kind', {
        kind: 'blend',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('b.distillery_code = :code', {
        code: 'G1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(b.region_id = :rid OR r.parent_id = :rid)',
        { rid: 'scotland' },
      );
      expect(qb.addSelect).toHaveBeenCalledWith(
        '(b.delisted_at)',
        'sort_value',
      );
      // Sold-out date first, then the release date.
      const order = qb.addOrderBy.mock.calls.map((c: unknown[]) => c[0]);
      expect(order.slice(0, 2)).toEqual(['sort_value', 'sort_released']);
    });

    it.each([
      [{ status: 'gone' }],
      [{ kind: 'gin' }],
      [{ limit: '500' }],
      [{ limit: 'abc' }],
      [{ offset: '-1' }],
    ])('400s on %o', async (query) => {
      await expect(service.list(query)).rejects.toThrow(BadRequestException);
    });
  });

  describe('search', () => {
    it('searches every bottle, 20 per page, best match first', async () => {
      await service.search({ q: 'smoke peat' });
      expect(qb.andWhere).not.toHaveBeenCalledWith('b.in_stock = true');
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('LIKE :word0'),
        { word0: '%smoke%' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('LIKE :word1'),
        { word1: '%peat%' },
      );
      expect(qb.addOrderBy).toHaveBeenNthCalledWith(
        1,
        'sort_rank',
        'ASC',
        'NULLS LAST',
      );
      expect(qb.limit).toHaveBeenCalledWith(20);
    });

    it('matches a typed code by prefix, shortest code first', async () => {
      await service.search({ q: '29.2' });
      expect(qb.andWhere).toHaveBeenCalledWith('b.code LIKE :codePrefix', {
        codePrefix: '29.2%',
      });
      expect(qb.addSelect).toHaveBeenCalledWith(
        '(length(b.code))',
        'sort_rank',
      );
    });

    it('escapes LIKE wildcards in the text', async () => {
      await service.search({ q: '100%' });
      expect(qb.andWhere).toHaveBeenCalledWith(expect.any(String), {
        word0: '%100\\%%',
      });
    });

    it('filters by field and range and sorts by a value', async () => {
      await service.search({
        profile: 'Deep, Rich & Dried Fruits',
        cask: 'oloroso',
        abv_min: '55',
        age_max: '20',
        category: 'rum',
        sort: 'abv',
        order: 'asc',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('= :profileKey'),
        { profileKey: 'deeprichdriedfruits' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('LIKE :cask0'),
        { cask0: '%oloroso%' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('b.abv >= :abvMin', {
        abvMin: 55,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('<= :ageMax'),
        { ageMax: 20 },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('c.category = :category', {
        category: 'rum',
      });
      expect(qb.addOrderBy).toHaveBeenCalledWith(
        'sort_value',
        'ASC',
        'NULLS LAST',
      );
    });
  });

  it('404s an unknown code', async () => {
    bottles.findOne!.mockResolvedValue(null);
    await expect(service.get('9.999')).rejects.toThrow(NotFoundException);
  });

  it('finds a bottle by cask code or by SKU', async () => {
    bottles.findOne!.mockResolvedValue(row());
    await service.get('g1.12');
    expect(bottles.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { code: 'G1.12' } }),
    );
    await service.get('SM0120EU0700610');
    expect(bottles.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { sku: 'SM0120EU0700610' } }),
    );
  });

  it('builds the admin status', async () => {
    const status = await service.adminStatus();
    expect(status.bottles).toEqual({
      total: 4,
      available: 2,
      delisted: 2,
      single_casks: 2,
      blends: 1,
      others: 1,
      without_region: 1,
      unknown_distillery: 0,
      last_seen_at: '2026-11-09T00:00:00.000Z',
    });
    expect(status.pages).toEqual({ bottle: 3, other: 5, gone: 0 });
    expect(status.scraper).toEqual({ running: false, recent_runs: [] });
  });
});
