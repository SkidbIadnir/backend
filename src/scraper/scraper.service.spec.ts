jest.mock('playwright', () => ({
  firefox: {
    launch: jest.fn().mockResolvedValue({
      newContext: jest.fn().mockResolvedValue({
        newPage: jest.fn().mockResolvedValue({
          goto: jest.fn().mockResolvedValue(null),
          waitForSelector: jest.fn().mockResolvedValue(null),
          locator: jest.fn().mockReturnValue({ click: jest.fn().mockResolvedValue(null) }),
          getByRole: jest.fn().mockReturnValue({ click: jest.fn().mockResolvedValue(null) }),
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
import { ScraperService, ScrapedWhiskyData, ScrapedWhiskyListItem } from './scraper.service';
import { SmwsLive } from '../entities/smws-live.entity';
import { SmwsArchive } from '../entities/smws-archive.entity';
import { SmwsDistillery } from '../entities/smws-distillery.entity';
import { createMockRepository, MockRepository } from '../test-utils/mock-repository.factory';
import { makeSmwsLive, makeScrapedWhisky, makeSmwsDistillery } from '../test-utils/fixtures';

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
        { provide: getRepositoryToken(SmwsDistillery), useValue: distilleryRepo },
      ],
    }).compile();

    service = module.get<ScraperService>(ScraperService);
  });

  // ─── findNewWhiskies ─────────────────────────────────────────────────────────

  describe('findNewWhiskies', () => {
    const findNew = (scraped: ScrapedWhiskyListItem[], existing: ScrapedWhiskyListItem[]) =>
      (service as any).findNewWhiskies(scraped, existing);

    it('returns items in scraped not present in existing', () => {
      const scraped = [{ title: 'A', href: '/a' }, { title: 'B', href: '/b' }];
      const existing = [{ title: 'A', href: '/a' }];
      expect(findNew(scraped, existing)).toEqual([{ title: 'B', href: '/b' }]);
    });

    it('returns empty array when all scraped items already exist', () => {
      const scraped = [{ title: 'A', href: '/a' }];
      const existing = [{ title: 'A', href: '/a' }];
      expect(findNew(scraped, existing)).toEqual([]);
    });

    it('returns all scraped items when existing list is empty', () => {
      const scraped = [{ title: 'A', href: '/a' }, { title: 'B', href: '/b' }];
      expect(findNew(scraped, [])).toEqual(scraped);
    });

    it('returns empty when both lists are empty', () => {
      expect(findNew([], [])).toEqual([]);
    });
  });

  // ─── findRemovedWhiskies ─────────────────────────────────────────────────────

  describe('findRemovedWhiskies', () => {
    const findRemoved = (scraped: ScrapedWhiskyListItem[], existing: ScrapedWhiskyListItem[]) =>
      (service as any).findRemovedWhiskies(scraped, existing);

    it('returns items in existing not present in scraped', () => {
      const scraped = [{ title: 'A', href: '/a' }];
      const existing = [{ title: 'A', href: '/a' }, { title: 'B', href: '/b' }];
      expect(findRemoved(scraped, existing)).toEqual([{ title: 'B', href: '/b' }]);
    });

    it('returns empty when no whiskies were removed', () => {
      const list = [{ title: 'A', href: '/a' }];
      expect(findRemoved(list, list)).toEqual([]);
    });

    it('returns all existing when scraped list is empty', () => {
      const existing = [{ title: 'A', href: '/a' }, { title: 'B', href: '/b' }];
      expect(findRemoved([], existing)).toEqual(existing);
    });

    it('returns empty when both lists are empty', () => {
      expect(findRemoved([], [])).toEqual([]);
    });
  });

  // ─── saveWhiskiesToDatabase ──────────────────────────────────────────────────

  describe('saveWhiskiesToDatabase', () => {
    beforeEach(() => {
      liveRepo.upsert!.mockResolvedValue({ identifiers: [{ id: 1 }], generatedMaps: [], raw: [] });
      liveRepo.findOne!.mockResolvedValue(makeSmwsLive());
    });

    it('calls distilleryRepo.findBy for whiskies missing distillery name', async () => {
      distilleryRepo.findBy!.mockResolvedValue([makeSmwsDistillery()]);
      const whisky = makeScrapedWhisky({ distillery: '', distilleryId: 1 });
      await service.saveWhiskiesToDatabase([whisky]);
      expect(distilleryRepo.findBy).toHaveBeenCalledTimes(1);
    });

    it('does not call distilleryRepo.findBy when distillery is already set', async () => {
      const whisky = makeScrapedWhisky({ distillery: 'Glenfarclas', distilleryId: 1 });
      await service.saveWhiskiesToDatabase([whisky]);
      expect(distilleryRepo.findBy).not.toHaveBeenCalled();
    });

    it('resolves distillery name from lookup map', async () => {
      distilleryRepo.findBy!.mockResolvedValue([makeSmwsDistillery({ smwsId: '1', distilleryName: 'Glenfarclas' })]);
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

    it('returns saved entities fetched via findOne', async () => {
      const entity = makeSmwsLive();
      liveRepo.findOne!.mockResolvedValue(entity);
      const result = await service.saveWhiskiesToDatabase([makeScrapedWhisky()]);
      expect(result).toEqual([entity]);
    });

    it('skips whiskies where findOne returns null', async () => {
      liveRepo.findOne!.mockResolvedValue(null);
      const result = await service.saveWhiskiesToDatabase([makeScrapedWhisky()]);
      expect(result).toEqual([]);
    });

    it('logs error and continues when upsert throws for a single whisky', async () => {
      liveRepo.upsert!
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValue({ identifiers: [], generatedMaps: [], raw: [] });
      const w1 = makeScrapedWhisky({ fullCode: '1.1', name: 'Whisky A' });
      const w2 = makeScrapedWhisky({ fullCode: '1.2', name: 'Whisky B' });
      liveRepo.findOne!.mockResolvedValue(makeSmwsLive());
      const result = await service.saveWhiskiesToDatabase([w1, w2]);
      // w1 upsert threw, so only w2 saved
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
});
