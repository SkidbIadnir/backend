import { createMockRepository } from '../../test-utils/mock-repository.factory';
import { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import { SmwsBottleSyncService } from './smws-bottle-sync.service';
import { ScrapedBottle } from './smws-site.scraper';

const url = (slug: string) => `https://smws.eu/${slug}`;
const page = (
  code: string,
  over: Partial<ScrapedBottle> = {},
): ScrapedBottle => ({
  code,
  name: `Bottle ${code}`,
  priceText: '€95.00',
  abvText: '58.3%',
  age: '12 years',
  caskType: 'Ex-bourbon',
  profile: 'Juicy, oak & vanilla',
  regionText: 'Speyside',
  ...over,
});

describe('SmwsBottleSyncService', () => {
  let lockFree: boolean;
  let runner: { connect: jest.Mock; query: jest.Mock; release: jest.Mock };
  let manager: { find: jest.Mock; update: jest.Mock; insert: jest.Mock };
  let dataSource: { createQueryRunner: jest.Mock; transaction: jest.Mock };
  let bottles: ReturnType<typeof createMockRepository>;
  let runs: ReturnType<typeof createMockRepository>;
  let codes: ReturnType<typeof createMockRepository>;
  let regions: { resolve: jest.Mock };
  let session: {
    listProducts: jest.Mock;
    readBottle: jest.Mock;
    close: jest.Mock;
  };
  let site: { open: jest.Mock };
  let service: SmwsBottleSyncService;

  beforeEach(() => {
    lockFree = true;
    runner = {
      connect: jest.fn(),
      query: jest.fn((sql: string) =>
        Promise.resolve(sql.includes('try') ? [{ locked: lockFree }] : []),
      ),
      release: jest.fn(),
    };
    manager = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      insert: jest.fn(),
    };
    dataSource = {
      createQueryRunner: jest.fn(() => runner),
      transaction: jest.fn((fn: (m: unknown) => unknown) => fn(manager)),
    };
    bottles = createMockRepository<TasteepSmwsBottle>();
    bottles.find!.mockResolvedValue([]);
    runs = createMockRepository();
    runs.save!.mockImplementation((r: object) =>
      Promise.resolve({ id: 7, ...r }),
    );
    runs.update!.mockResolvedValue({ affected: 0 });
    codes = createMockRepository();
    codes.find!.mockResolvedValue([{ code: '1', regionId: 'scotland' }]);
    regions = { resolve: jest.fn().mockResolvedValue(null) };
    session = {
      listProducts: jest
        .fn()
        .mockResolvedValue({ urls: [], pages: 1, complete: true }),
      readBottle: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    site = { open: jest.fn().mockResolvedValue(session) };
    service = new SmwsBottleSyncService(
      dataSource as never,
      bottles as never,
      runs as never,
      codes as never,
      regions as never,
      site as never,
    );
  });

  const lastSavedRun = () => {
    const calls = runs.save!.mock.calls as [Record<string, unknown>][];
    return calls[calls.length - 1][0];
  };
  const anyDate: unknown = expect.any(Date);

  it('applies a full run: seen, delisted after the second miss, new bottle inserted', async () => {
    bottles.find!.mockResolvedValue([
      { code: '1.1', url: url('a'), delistedAt: null, consecutiveMisses: 0 },
      { code: '1.2', url: url('b'), delistedAt: null, consecutiveMisses: 1 },
      ...['c', 'd', 'e', 'f'].map((s, i) => ({
        code: `2.${i}`,
        url: url(s),
        delistedAt: null,
        consecutiveMisses: 0,
      })),
    ]);
    session.listProducts.mockResolvedValue({
      urls: [url('a'), url('c'), url('d'), url('e'), url('f'), url('new')],
      pages: 1,
      complete: true,
    });
    session.readBottle.mockResolvedValue(page('1.3'));

    const run = await service.run('cron');

    expect(session.readBottle).toHaveBeenCalledWith(url('new'));
    expect(manager.update).toHaveBeenCalledWith(
      TasteepSmwsBottle,
      expect.anything(),
      expect.objectContaining({ consecutiveMisses: 0, delistedAt: null }),
    );
    expect(manager.update).toHaveBeenCalledWith(
      TasteepSmwsBottle,
      expect.anything(),
      expect.objectContaining({ delistedAt: anyDate }),
    );
    expect(manager.insert).toHaveBeenCalledWith(
      TasteepSmwsBottle,
      expect.objectContaining({
        code: '1.3',
        distilleryCode: '1',
        url: url('new'),
        priceAmount: 95,
        priceCurrency: 'EUR',
        abv: 58.3,
        regionId: 'scotland',
        firstSeenAt: anyDate,
      }),
    );
    expect(run).toEqual(
      expect.objectContaining({
        status: 'succeeded',
        listed: 6,
        added: 1,
        delisted: 1,
        missed: 0,
      }),
    );
    expect(session.close).toHaveBeenCalled();
    expect(runner.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_unlock($1)',
      expect.any(Array),
    );
    expect(runner.release).toHaveBeenCalled();
  });

  it('records a partial run and delists nothing when the listing is short', async () => {
    bottles.find!.mockResolvedValue(
      ['a', 'b', 'c'].map((s, i) => ({
        code: `1.${i}`,
        url: url(s),
        delistedAt: null,
        consecutiveMisses: 1,
      })),
    );
    const run = await service.run('cron');
    expect(run).toEqual(
      expect.objectContaining({ status: 'partial', delisted: 0, missed: 0 }),
    );
    expect(run?.note).toMatch(/0 bottles for 3/);
  });

  it('records a failed run when the browser cannot start, and releases the lock', async () => {
    site.open.mockRejectedValue(new Error('no firefox'));
    const run = await service.run('admin');
    expect(run).toEqual(
      expect.objectContaining({ status: 'failed', error: 'no firefox' }),
    );
    expect(lastSavedRun().finishedAt).toBeInstanceOf(Date);
    expect(runner.release).toHaveBeenCalled();
  });

  it('skips when another process holds the lock', async () => {
    lockFree = false;
    await expect(service.run('cron')).resolves.toBeNull();
    expect(site.open).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('is running from the moment run() is called, and refuses a second run', async () => {
    const first = service.run('cron');
    expect(service.isRunning()).toBe(true);
    await expect(service.run('admin')).resolves.toBeNull();
    await first;
    expect(service.isRunning()).toBe(false);
  });

  it('notes bottle pages that failed and does not re-read non-bottle pages next run', async () => {
    session.listProducts.mockResolvedValue({
      urls: [url('gift'), url('broken')],
      pages: 1,
      complete: true,
    });
    session.readBottle.mockImplementation((u: string) =>
      u === url('gift')
        ? Promise.resolve(null)
        : Promise.reject(new Error('timeout')),
    );

    const run = await service.run('cron');
    expect(run?.note).toMatch(/1 bottle page\(s\) failed/);

    session.readBottle.mockClear();
    await service.run('cron');
    expect(session.readBottle).toHaveBeenCalledTimes(1);
    expect(session.readBottle).toHaveBeenCalledWith(url('broken'));
  });

  it('marks leftover running rows as failed at boot when no one holds the lock', async () => {
    await service.onModuleInit();
    expect(runs.update).toHaveBeenCalledWith(
      { status: 'running' },
      expect.objectContaining({ status: 'failed' }),
    );
  });

  describe('toFreshBottles', () => {
    it('prefers the region from the bottle text, then the code, and de-duplicates codes', async () => {
      regions.resolve.mockImplementation((_: null, text: string) =>
        Promise.resolve(text === 'Islay' ? { id: 'scotland/islay' } : null),
      );
      const fresh = await service.toFreshBottles([
        { url: url('x'), page: page('1.5', { regionText: 'Islay' }) },
        { url: url('y'), page: page('1.6', { regionText: 'Nowhere' }) },
        { url: url('z'), page: page('1.6', { regionText: '' }) },
        { url: url('w'), page: page('nope') },
      ]);
      expect(fresh.map((b) => [b.code, b.url, b.regionId])).toEqual([
        ['1.5', url('x'), 'scotland/islay'],
        ['1.6', url('z'), 'scotland'],
      ]);
    });
  });

  describe('apply', () => {
    it('treats a known code under a new URL as seen, not delisted', async () => {
      manager.find.mockResolvedValue([
        { code: '1.1', delistedAt: new Date('2026-01-01') },
      ]);
      const fresh = await service.toFreshBottles([
        { url: url('moved'), page: page('1.1') },
      ]);
      const result = await service.apply(
        manager as never,
        {
          trusted: true,
          untrustedReason: null,
          seen: [],
          relisted: [],
          missed: [],
          delisted: ['1.1'],
          unknownUrls: [url('moved')],
        },
        fresh,
        new Date(),
      );
      expect(result).toEqual({ added: 0, relisted: 1, missed: 0, delisted: 0 });
      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(
        TasteepSmwsBottle,
        { code: '1.1' },
        expect.objectContaining({ url: url('moved'), delistedAt: null }),
      );
    });
  });
});
