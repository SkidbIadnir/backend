jest.mock('playwright', () => ({
  firefox: {
    launch: jest.fn().mockResolvedValue({
      newContext: jest.fn().mockResolvedValue({
        newPage: jest.fn().mockResolvedValue({
          goto: jest.fn().mockResolvedValue(null),
          waitForSelector: jest.fn().mockResolvedValue(null),
          locator: jest
            .fn()
            .mockReturnValue({ click: jest.fn().mockResolvedValue(null) }),
          getByRole: jest
            .fn()
            .mockReturnValue({ click: jest.fn().mockResolvedValue(null) }),
          evaluate: jest.fn().mockResolvedValue([]),
          close: jest.fn().mockResolvedValue(null),
          url: jest.fn().mockReturnValue('https://smws.eu/product/1'),
        }),
        close: jest.fn().mockResolvedValue(null),
      }),
      close: jest.fn().mockResolvedValue(null),
    }),
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScraperService, ScrapedWhiskyListItem } from './scraper.service';
import { SmwsLive } from '../entities/smws-live.entity';
import { SmwsArchive } from '../entities/smws-archive.entity';
import { SmwsDistillery } from '../entities/smws-distillery.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';
import {
  makeSmwsLive,
  makeScrapedWhisky,
  makeSmwsDistillery,
} from '../test-utils/fixtures';

describe('ScraperService', () => {
  let service: ScraperService;
  let liveRepo: MockRepository<SmwsLive>;
  let archiveRepo: MockRepository<SmwsArchive>;
  let distilleryRepo: MockRepository<SmwsDistillery>;

  beforeEach(async () => {
    liveRepo = createMockRepository<SmwsLive>();
    archiveRepo = createMockRepository<SmwsArchive>();
    distilleryRepo = createMockRepository<SmwsDistillery>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScraperService,
        { provide: getRepositoryToken(SmwsLive), useValue: liveRepo },
        { provide: getRepositoryToken(SmwsArchive), useValue: archiveRepo },
        {
          provide: getRepositoryToken(SmwsDistillery),
          useValue: distilleryRepo,
        },
      ],
    }).compile();

    service = module.get<ScraperService>(ScraperService);
  });

  // ─── findNewWhiskies ─────────────────────────────────────────────────────────

  describe('findNewWhiskies', () => {
    const findNew = (
      scraped: ScrapedWhiskyListItem[],
      existing: ScrapedWhiskyListItem[],
    ) => (service as any).findNewWhiskies(scraped, existing);

    it('returns items in scraped not present in existing', () => {
      const scraped = [
        { title: 'A', href: '/a' },
        { title: 'B', href: '/b' },
      ];
      const existing = [{ title: 'A', href: '/a' }];
      expect(findNew(scraped, existing)).toEqual([{ title: 'B', href: '/b' }]);
    });

    it('returns empty array when all scraped items already exist', () => {
      const scraped = [{ title: 'A', href: '/a' }];
      const existing = [{ title: 'A', href: '/a' }];
      expect(findNew(scraped, existing)).toEqual([]);
    });

    it('matches by href, not title — a changed title with the same href is not new', () => {
      const scraped = [{ title: 'A (re-released)', href: '/a' }];
      const existing = [{ title: 'A', href: '/a' }];
      expect(findNew(scraped, existing)).toEqual([]);
    });

    it('treats same title with a different href as a distinct (new) item', () => {
      const scraped = [{ title: 'A', href: '/a-2' }];
      const existing = [{ title: 'A', href: '/a' }];
      expect(findNew(scraped, existing)).toEqual([
        { title: 'A', href: '/a-2' },
      ]);
    });

    it('returns all scraped items when existing list is empty', () => {
      const scraped = [
        { title: 'A', href: '/a' },
        { title: 'B', href: '/b' },
      ];
      expect(findNew(scraped, [])).toEqual(scraped);
    });

    it('returns empty when both lists are empty', () => {
      expect(findNew([], [])).toEqual([]);
    });
  });

  // ─── findRemovedWhiskies ─────────────────────────────────────────────────────

  describe('findRemovedWhiskies', () => {
    const findRemoved = (
      scraped: ScrapedWhiskyListItem[],
      existing: ScrapedWhiskyListItem[],
    ) => (service as any).findRemovedWhiskies(scraped, existing);

    it('returns items in existing not present in scraped', () => {
      const scraped = [{ title: 'A', href: '/a' }];
      const existing = [
        { title: 'A', href: '/a' },
        { title: 'B', href: '/b' },
      ];
      expect(findRemoved(scraped, existing)).toEqual([
        { title: 'B', href: '/b' },
      ]);
    });

    it('returns empty when no whiskies were removed', () => {
      const list = [{ title: 'A', href: '/a' }];
      expect(findRemoved(list, list)).toEqual([]);
    });

    it('matches by href, not title — a changed title with the same href is not removed', () => {
      const scraped = [{ title: 'A (re-released)', href: '/a' }];
      const existing = [{ title: 'A', href: '/a' }];
      expect(findRemoved(scraped, existing)).toEqual([]);
    });

    it('never treats an existing row with no href as removed', () => {
      const scraped = [{ title: 'B', href: '/b' }];
      const existing = [{ title: 'A', href: '' }];
      expect(findRemoved(scraped, existing)).toEqual([]);
    });

    it('returns all existing when scraped list is empty', () => {
      const existing = [
        { title: 'A', href: '/a' },
        { title: 'B', href: '/b' },
      ];
      expect(findRemoved([], existing)).toEqual(existing);
    });

    it('returns empty when both lists are empty', () => {
      expect(findRemoved([], [])).toEqual([]);
    });
  });

  // ─── saveWhiskiesToDatabase ──────────────────────────────────────────────────

  describe('saveWhiskiesToDatabase', () => {
    beforeEach(() => {
      liveRepo.upsert!.mockResolvedValue({
        identifiers: [{ id: 1 }],
        generatedMaps: [],
        raw: [],
      });
      liveRepo.find!.mockResolvedValue([makeSmwsLive()]);
    });

    it('calls distilleryRepo.findBy for whiskies missing distillery name', async () => {
      distilleryRepo.findBy!.mockResolvedValue([makeSmwsDistillery()]);
      const whisky = makeScrapedWhisky({ distillery: '', distilleryId: 1 });
      await service.saveWhiskiesToDatabase([whisky]);
      expect(distilleryRepo.findBy).toHaveBeenCalledTimes(1);
    });

    it('does not call distilleryRepo.findBy when distillery is already set', async () => {
      const whisky = makeScrapedWhisky({
        distillery: 'Glenfarclas',
        distilleryId: 1,
      });
      await service.saveWhiskiesToDatabase([whisky]);
      expect(distilleryRepo.findBy).not.toHaveBeenCalled();
    });

    it('resolves distillery name from lookup map', async () => {
      distilleryRepo.findBy!.mockResolvedValue([
        makeSmwsDistillery({ smwsId: '1', distilleryName: 'Glenfarclas' }),
      ]);
      const whisky = makeScrapedWhisky({ distillery: '', distilleryId: 1 });
      await service.saveWhiskiesToDatabase([whisky]);
      expect(whisky.distillery).toBe('Glenfarclas');
    });

    it('falls back to empty string when distilleryId has no match', async () => {
      distilleryRepo.findBy!.mockResolvedValue([]);
      const whisky = makeScrapedWhisky({ distillery: '', distilleryId: 99 });
      await service.saveWhiskiesToDatabase([whisky]);
      expect(whisky.distillery).toBe('');
    });

    it('calls liveRepo.upsert with conflictPaths [fullCode]', async () => {
      const whisky = makeScrapedWhisky();
      await service.saveWhiskiesToDatabase([whisky]);
      expect(liveRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ fullCode: whisky.fullCode }),
        expect.objectContaining({ conflictPaths: ['fullCode'] }),
      );
    });

    it('sets isNew=true and newSince when isNew param is true', async () => {
      const whisky = makeScrapedWhisky();
      await service.saveWhiskiesToDatabase([whisky], true);
      const upsertArg = (liveRepo.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertArg.isNew).toBe(true);
      expect(upsertArg.newSince).toBeInstanceOf(Date);
    });

    it('sets isNew=false and newSince=null when isNew param is false', async () => {
      const whisky = makeScrapedWhisky();
      await service.saveWhiskiesToDatabase([whisky], false);
      const upsertArg = (liveRepo.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertArg.isNew).toBe(false);
      expect(upsertArg.newSince).toBeNull();
    });

    it('returns saved entities fetched via a single batched find', async () => {
      const entity = makeSmwsLive();
      liveRepo.find!.mockResolvedValue([entity]);
      const result = await service.saveWhiskiesToDatabase([
        makeScrapedWhisky(),
      ]);
      expect(result).toEqual([entity]);
      expect(liveRepo.find).toHaveBeenCalledTimes(1);
    });

    it('does not call find when every upsert fails', async () => {
      liveRepo.upsert!.mockRejectedValue(new Error('DB error'));
      const result = await service.saveWhiskiesToDatabase([
        makeScrapedWhisky(),
      ]);
      expect(result).toEqual([]);
      expect(liveRepo.find).not.toHaveBeenCalled();
    });

    it('skips whiskies not present in the batched find result', async () => {
      liveRepo.find!.mockResolvedValue([]);
      const result = await service.saveWhiskiesToDatabase([
        makeScrapedWhisky(),
      ]);
      expect(result).toEqual([]);
    });

    it('does not coerce a distilleryId of 0 to null', async () => {
      const whisky = makeScrapedWhisky({ distilleryId: 0, distillery: 'X' });
      await service.saveWhiskiesToDatabase([whisky]);
      const upsertArg = (liveRepo.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertArg.distilleryCode).toBe('0');
    });

    it('logs error and continues when upsert throws for a single whisky', async () => {
      liveRepo
        .upsert!.mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValue({ identifiers: [], generatedMaps: [], raw: [] });
      const w1 = makeScrapedWhisky({ fullCode: '1.1', name: 'Whisky A' });
      const w2 = makeScrapedWhisky({ fullCode: '1.2', name: 'Whisky B' });
      liveRepo.find!.mockResolvedValue([makeSmwsLive({ fullCode: '1.2' })]);
      const result = await service.saveWhiskiesToDatabase([w1, w2]);
      // w1 upsert threw, so only w2's fullCode is in the batched find lookup
      expect(result).toHaveLength(1);
    });
  });

  // ─── runScraper smoke test ───────────────────────────────────────────────────

  describe('runScraper (smoke)', () => {
    beforeEach(() => {
      jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);
      liveRepo.find!.mockResolvedValue([]);
    });

    it('calls liveRepo.find to fetch existing whiskies', async () => {
      await service.runScraper();
      expect(liveRepo.find).toHaveBeenCalled();
    });

    it('does not throw with all dependencies mocked', async () => {
      await expect(service.runScraper()).resolves.not.toThrow();
    });
  });

  // ─── collectAllPagesBasicInfo ────────────────────────────────────────────────

  describe('collectAllPagesBasicInfo', () => {
    const collect = (page: any, buildPageUrl: (n: number) => string) =>
      (service as any).collectAllPagesBasicInfo(page, buildPageUrl, 'test');

    beforeEach(() => {
      jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);
    });

    it('reports complete:false after exhausting retries on a page error', async () => {
      const page = {
        goto: jest.fn().mockResolvedValue(null),
        waitForSelector: jest.fn().mockRejectedValue(new Error('timeout')),
        evaluate: jest.fn().mockResolvedValue([]),
      };
      const result = await collect(page, (n) => `url${n}`);
      expect(result).toEqual({ items: [], complete: false });
      // 1 initial attempt + 2 retries (maxPageErrorRetries)
      expect(page.waitForSelector).toHaveBeenCalledTimes(3);
    });

    it('recovers from a transient error and still reports complete:true', async () => {
      const page = {
        goto: jest.fn().mockResolvedValue(null),
        waitForSelector: jest
          .fn()
          .mockRejectedValueOnce(new Error('timeout'))
          .mockResolvedValue(null),
        evaluate: jest
          .fn()
          .mockResolvedValueOnce([{ title: 'A', href: '/a' }])
          .mockResolvedValue([]),
      };
      const result = await collect(page, (n) => `url${n}`);
      expect(result).toEqual({
        items: [{ title: 'A', href: '/a' }],
        complete: true,
      });
    });

    it('reaching a genuine empty page still reports complete:true', async () => {
      const page = {
        goto: jest.fn().mockResolvedValue(null),
        waitForSelector: jest.fn().mockResolvedValue(null),
        evaluate: jest.fn().mockResolvedValue([]),
      };
      const result = await collect(page, (n) => `url${n}`);
      expect(result).toEqual({ items: [], complete: true });
    });
  });

  // ─── incomplete list handling in runScraper ──────────────────────────────────

  describe('runScraper — incomplete list handling', () => {
    beforeEach(() => {
      jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);
    });

    it('skips markWhiskiesAsUnavailable when list collection is incomplete', async () => {
      jest
        .spyOn(service as any, 'collectAllWhiskyBasicInfo')
        .mockResolvedValue({
          items: [],
          complete: false,
        });
      liveRepo.find!.mockResolvedValue([
        { name: 'Existing', url: 'https://smws.eu/product/existing' },
      ]);
      const markUnavailableSpy = jest.spyOn(
        service as any,
        'markWhiskiesAsUnavailable',
      );

      await service.runScraper();

      expect(markUnavailableSpy).not.toHaveBeenCalled();
    });

    it('still marks removed whiskies unavailable when list collection completes', async () => {
      jest
        .spyOn(service as any, 'collectAllWhiskyBasicInfo')
        .mockResolvedValue({
          items: [],
          complete: true,
        });
      liveRepo.find!.mockResolvedValue([
        { name: 'Existing', url: 'https://smws.eu/product/existing' },
      ]);
      const markUnavailableSpy = jest.spyOn(
        service as any,
        'markWhiskiesAsUnavailable',
      );

      await service.runScraper();

      expect(markUnavailableSpy).toHaveBeenCalledWith([
        { title: 'Existing', href: 'https://smws.eu/product/existing' },
      ]);
    });
  });

  // ─── overlapping run guard ────────────────────────────────────────────────────

  describe('overlapping run guard', () => {
    beforeEach(() => {
      jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);
      liveRepo.find!.mockResolvedValue([]);
    });

    it('skips a second concurrent runScraper call while one is in-flight', async () => {
      const warnSpy = jest.spyOn((service as any).logger, 'warn');

      const first = service.runScraper();
      const second = service.runScraper();
      await Promise.all([first, second]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('previous run is still in progress'),
      );
    });

    it('allows a subsequent run once the previous one has finished', async () => {
      await service.runScraper();
      const warnSpy = jest.spyOn((service as any).logger, 'warn');
      await service.runScraper();

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('previous run is still in progress'),
      );
    });
  });
});
