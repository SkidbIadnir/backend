import { createMockRepository } from '../../test-utils/mock-repository.factory';
import { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import { smwsProductPage } from '../test-utils/smws-page.fixture';
import { SmwsBottleSyncService } from './smws-bottle-sync.service';
import { CATALOG_RULES_VERSION } from './smws-catalog.rules';
import type { PageResponse } from './smws-http.client';

const url = (slug: string) => `https://smws.eu/${slug}`;
const ok = (body: string): PageResponse => ({ status: 200, body });
const anyDate: unknown = expect.any(Date);

/** A stored catalog row for the `barrelbutt` fixture page. */
const storedBarrelbutt = (over: Partial<TasteepSmwsBottle> = {}) =>
  ({
    sku: '001309GX0700614',
    productId: 6130,
    url: url('barrelbutt'),
    kind: 'single_cask',
    code: '1.309',
    distilleryCode: '1',
    caskNo: '309',
    batch: null,
    name: 'Barrelbutt',
    priceText: '€140.00',
    priceAmount: 140,
    priceCurrency: 'EUR',
    abv: 56.3,
    age: '14 years',
    caskType: '1st fill ex-oloroso butt',
    distilledDate: '2012-01-25',
    profile: 'Dried Fruits & Spices',
    regionText: 'Speyside',
    regionId: 'scotland/speyside',
    categories: [],
    releasedAt: null,
    inStock: true,
    stock: 45,
    firstSeenAt: new Date('2026-11-01T00:00:00Z'),
    lastSeenAt: new Date('2026-11-08T00:00:00Z'),
    delistedAt: null,
    ...over,
  }) as TasteepSmwsBottle;

describe('SmwsBottleSyncService', () => {
  let lockFree: boolean;
  let runner: { connect: jest.Mock; query: jest.Mock; release: jest.Mock };
  let saved: Record<string, unknown>[];
  let pageWrites: Record<string, unknown>[];
  let dataSource: { createQueryRunner: jest.Mock; transaction: jest.Mock };
  let bottles: ReturnType<typeof createMockRepository>;
  let pages: ReturnType<typeof createMockRepository>;
  let runs: ReturnType<typeof createMockRepository>;
  let codes: ReturnType<typeof createMockRepository>;
  let regions: { resolve: jest.Mock };
  let http: { get: jest.Mock; productUrls: jest.Mock };
  let service: SmwsBottleSyncService;

  /** Repository stub whose query builder records `tasteep_smws_pages` upserts. */
  const pageRepo = () => {
    const repo = createMockRepository();
    const qb: Record<string, jest.Mock> = {};
    qb.insert = jest.fn(() => qb);
    qb.values = jest.fn((v: Record<string, unknown>) => {
      pageWrites.push(v);
      return qb;
    });
    qb.orUpdate = jest.fn(() => qb);
    qb.execute = jest.fn().mockResolvedValue({});
    repo.createQueryBuilder!.mockReturnValue(qb);
    return repo;
  };

  beforeEach(() => {
    lockFree = true;
    saved = [];
    pageWrites = [];
    runner = {
      connect: jest.fn(),
      query: jest.fn((sql: string) =>
        Promise.resolve(sql.includes('try') ? [{ locked: lockFree }] : []),
      ),
      release: jest.fn(),
    };
    pages = pageRepo();
    pages.find!.mockResolvedValue([]);
    const txPages = pageRepo();
    dataSource = {
      createQueryRunner: jest.fn(() => runner),
      transaction: jest.fn((fn: (m: unknown) => unknown) =>
        fn({
          save: jest.fn((_: unknown, row: Record<string, unknown>) => {
            saved.push(row);
            return Promise.resolve(row);
          }),
          getRepository: () => txPages,
        }),
      ),
    };
    bottles = createMockRepository<TasteepSmwsBottle>();
    bottles.find!.mockResolvedValue([]);
    bottles.findOne!.mockResolvedValue(null);
    runs = createMockRepository();
    runs.save!.mockImplementation((r: object) =>
      Promise.resolve({ id: 7, ...r }),
    );
    runs.update!.mockResolvedValue({ affected: 0 });
    codes = createMockRepository();
    codes.findOne!.mockResolvedValue({ code: '1', regionId: 'scotland' });
    regions = {
      resolve: jest.fn((_: null, text: string) =>
        Promise.resolve(
          text === 'Speyside' ? { id: 'scotland/speyside' } : null,
        ),
      ),
    };
    http = {
      productUrls: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({ status: 404, body: null }),
    };
    service = new SmwsBottleSyncService(
      dataSource as never,
      bottles as never,
      pages as never,
      runs as never,
      codes as never,
      regions as never,
      http as never,
    );
  });

  describe('discovery', () => {
    it('reads unknown sitemap URLs only and stores bottles with every field', async () => {
      http.productUrls.mockResolvedValue([url('barrelbutt'), url('known')]);
      pages.find!.mockResolvedValueOnce([{ url: url('known') }]);
      http.get.mockResolvedValue(ok(smwsProductPage()));

      const run = await service.run('cron');

      expect(http.get).toHaveBeenCalledTimes(1);
      expect(http.get).toHaveBeenCalledWith(url('barrelbutt'));
      expect(saved[0]).toEqual(
        expect.objectContaining({
          sku: '001309GX0700614',
          kind: 'single_cask',
          code: '1.309',
          name: 'Barrelbutt',
          priceAmount: 140,
          abv: 56.3,
          age: '14 years',
          caskType: '1st fill ex-oloroso butt',
          distilledDate: '2012-01-25',
          profile: 'Dried Fruits & Spices',
          regionText: 'Speyside',
          regionId: 'scotland/speyside',
          inStock: true,
          stock: 45,
          firstSeenAt: anyDate,
          lastSeenAt: anyDate,
          delistedAt: null,
        }),
      );
      expect(run).toEqual(
        expect.objectContaining({
          status: 'succeeded',
          sitemapUrls: 2,
          discovered: 1,
          added: 1,
          failed: 0,
        }),
      );
    });

    it('records a page without an ABV as other, without a bottle', async () => {
      http.productUrls.mockResolvedValue([url('gift-card')]);
      http.get.mockResolvedValue(
        ok(smwsProductPage({ info: { Size: 'n/a' }, custom: {} })),
      );
      const run = await service.run('cron');
      expect(saved).toEqual([]);
      expect(pageWrites).toEqual([
        expect.objectContaining({
          url: url('gift-card'),
          kind: 'other',
          sku: null,
        }),
      ]);
      expect(run?.added).toBe(0);
    });

    it('records a 404 as gone', async () => {
      http.productUrls.mockResolvedValue([url('vanished')]);
      await service.run('cron');
      expect(pageWrites).toEqual([
        expect.objectContaining({ url: url('vanished'), kind: 'gone' }),
      ]);
    });

    it('stores a sold-out bottle as archive, with no delisting date', async () => {
      http.productUrls.mockResolvedValue([url('barrelbutt')]);
      http.get.mockResolvedValue(
        ok(smwsProductPage({ inStock: false, stockLevel: null })),
      );
      await service.run('cron');
      expect(saved[0]).toEqual(
        expect.objectContaining({ inStock: false, stock: 0, delistedAt: null }),
      );
    });

    it('does not record a failed read, so it is retried next run', async () => {
      http.productUrls.mockResolvedValue([url('barrelbutt')]);
      http.get.mockRejectedValue(new Error('timeout'));
      const run = await service.run('cron');
      expect(pageWrites).toEqual([]);
      expect(run).toEqual(
        expect.objectContaining({ status: 'partial', failed: 1 }),
      );
    });

    it('still checks stock when the sitemap is down', async () => {
      http.productUrls.mockRejectedValue(new Error('HTTP 503'));
      bottles.find!.mockResolvedValueOnce([
        { sku: 'x', url: url('barrelbutt') },
      ]);
      http.get.mockResolvedValue(ok(smwsProductPage()));
      const run = await service.run('cron');
      expect(http.get).toHaveBeenCalledWith(url('barrelbutt'));
      expect(run?.status).toBe('partial');
      expect(run?.note).toMatch(/Sitemap unavailable/);
    });
  });

  describe('stock checks', () => {
    beforeEach(() => {
      bottles.find!.mockResolvedValueOnce([
        { sku: '001309GX0700614', url: url('barrelbutt') },
      ]);
    });

    it('delists a bottle whose page says out of stock', async () => {
      bottles.findOne!.mockResolvedValue(storedBarrelbutt());
      http.get.mockResolvedValue(
        ok(smwsProductPage({ inStock: false, stockLevel: null })),
      );
      const run = await service.run('cron');
      expect(saved[0]).toEqual(
        expect.objectContaining({ inStock: false, delistedAt: anyDate }),
      );
      expect(run).toEqual(expect.objectContaining({ checked: 1, delisted: 1 }));
    });

    it('relists a bottle back in stock', async () => {
      bottles.findOne!.mockResolvedValue(
        storedBarrelbutt({
          inStock: false,
          delistedAt: new Date('2026-11-05T00:00:00Z'),
        }),
      );
      http.get.mockResolvedValue(ok(smwsProductPage()));
      const run = await service.run('cron');
      expect(saved[0]).toEqual(
        expect.objectContaining({ inStock: true, delistedAt: null }),
      );
      expect(run?.relisted).toBe(1);
    });

    it('keeps the first-seen date and every stored field the page lacks', async () => {
      bottles.findOne!.mockResolvedValue(storedBarrelbutt());
      http.get.mockResolvedValue(
        ok(
          smwsProductPage({
            info: { ABV: '56.3%' },
            custom: { ABV: '56.3%' },
            categories: [],
          }),
        ),
      );
      await service.run('cron');
      expect(saved[0]).toEqual(
        expect.objectContaining({
          firstSeenAt: new Date('2026-11-01T00:00:00Z'),
          distilledDate: '2012-01-25',
          caskType: '1st fill ex-oloroso butt',
          profile: 'Dried Fruits & Spices',
          regionId: 'scotland/speyside',
          age: '14 years',
        }),
      );
    });

    it('changes nothing when a known bottle page no longer looks like a bottle', async () => {
      bottles.findOne!.mockResolvedValue(storedBarrelbutt());
      http.get.mockResolvedValue(ok('<html><body>Maintenance</body></html>'));
      const run = await service.run('cron');
      expect(saved).toEqual([]);
      expect(pageWrites).toEqual([]);
      expect(run).toEqual(
        expect.objectContaining({ status: 'partial', failed: 1 }),
      );
    });

    it('delists an in-stock bottle whose page is gone', async () => {
      bottles.findOne!.mockResolvedValue(storedBarrelbutt());
      http.get.mockResolvedValue({ status: 404, body: null });
      const run = await service.run('cron');
      expect(bottles.update).toHaveBeenCalledWith(
        { sku: '001309GX0700614' },
        expect.objectContaining({ inStock: false, delistedAt: anyDate }),
      );
      expect(run?.delisted).toBe(1);
    });
  });

  describe('rules upgrades', () => {
    it('re-reads bottle pages read under older rules and records the new version', async () => {
      pages
        .find!.mockResolvedValueOnce([]) // known URLs
        .mockResolvedValueOnce([]) // `other` pages due for a recheck
        .mockResolvedValueOnce([{ url: url('barrelbutt') }]); // older rules
      bottles.findOne!.mockResolvedValue(
        storedBarrelbutt({ name: 'PÃ¢tisserie', inStock: false }),
      );
      http.get.mockResolvedValue(
        ok(smwsProductPage({ title: 'PÃ¢tisserie', inStock: false })),
      );

      const run = await service.run('cron');

      expect(pages.find).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            kind: 'bottle',
            rulesVersion: expect.anything() as unknown,
          }) as unknown,
        }),
      );
      expect(http.get).toHaveBeenCalledWith(url('barrelbutt'));
      expect(saved[0]).toEqual(expect.objectContaining({ name: 'Pâtisserie' }));
      expect(pageWrites[0]).toEqual(
        expect.objectContaining({
          kind: 'bottle',
          rulesVersion: CATALOG_RULES_VERSION,
        }),
      );
      expect(run).toEqual(
        expect.objectContaining({ status: 'succeeded', checked: 1 }),
      );
    });
  });

  describe('locking', () => {
    it('skips when another process holds the lock', async () => {
      lockFree = false;
      await expect(service.run('cron')).resolves.toBeNull();
      expect(http.productUrls).not.toHaveBeenCalled();
      expect(runner.release).toHaveBeenCalled();
    });

    it('is running from the moment run() is called, and refuses a second run', async () => {
      const first = service.run('cron');
      expect(service.isRunning()).toBe(true);
      await expect(service.run('admin')).resolves.toBeNull();
      await first;
      expect(service.isRunning()).toBe(false);
    });

    it('marks leftover running rows as failed at boot when no one holds the lock', async () => {
      await service.onModuleInit();
      expect(runs.update).toHaveBeenCalledWith(
        { status: 'running' },
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('records a failed run and releases the lock when something unexpected throws', async () => {
      pages.find!.mockRejectedValue(new Error('db down'));
      const run = await service.run('admin');
      expect(run).toEqual(
        expect.objectContaining({ status: 'failed', error: 'db down' }),
      );
      expect(runner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1)',
        expect.any(Array),
      );
    });
  });
});
