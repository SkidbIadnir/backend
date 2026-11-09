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
      total: '3',
      available: '2',
      single_casks: '2',
      without_region: '1',
      unknown_distillery: '0',
      last_seen_at: new Date('2026-11-09T00:00:00Z'),
    });
    for (const m of ['leftJoin', 'leftJoinAndSelect', 'skip', 'take']) {
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
      expect(qb.addOrderBy).toHaveBeenCalledWith(
        'b.releasedAt',
        'DESC',
        'NULLS LAST',
      );
      expect(qb.take).toHaveBeenCalledWith(50);
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
      expect(qb.orderBy).toHaveBeenCalledWith(
        'b.delistedAt',
        'DESC',
        'NULLS LAST',
      );
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
      total: 3,
      available: 2,
      delisted: 1,
      single_casks: 2,
      blends: 1,
      without_region: 1,
      unknown_distillery: 0,
      last_seen_at: '2026-11-09T00:00:00.000Z',
    });
    expect(status.pages).toEqual({ bottle: 3, other: 5, gone: 0 });
    expect(status.scraper).toEqual({ running: false, recent_runs: [] });
  });
});
