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
import { DiscordService } from '../discord/discord.service';
import { UserAlert } from '../entities/user-alert.entity';
import { createMockRepository, MockRepository } from '../test-utils/mock-repository.factory';
import { makeSmwsLive, makeUserAlert, makeScrapedWhisky, makeSmwsDistillery } from '../test-utils/fixtures';

describe('ScraperService', () => {
  let service: ScraperService;
  let liveRepo: MockRepository<SmwsLive>;
  let archiveRepo: MockRepository<SmwsArchive>;
  let distilleryRepo: MockRepository<SmwsDistillery>;
  let discordService: { getAllAlerts: jest.Mock; sendAlertNotification: jest.Mock };

  beforeEach(async () => {
    liveRepo = createMockRepository<SmwsLive>();
    archiveRepo = createMockRepository<SmwsArchive>();
    distilleryRepo = createMockRepository<SmwsDistillery>();
    discordService = {
      getAllAlerts: jest.fn().mockResolvedValue([]),
      sendAlertNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScraperService,
        { provide: getRepositoryToken(SmwsLive), useValue: liveRepo },
        { provide: getRepositoryToken(SmwsArchive), useValue: archiveRepo },
        { provide: getRepositoryToken(SmwsDistillery), useValue: distilleryRepo },
        { provide: DiscordService, useValue: discordService },
      ],
    }).compile();

    service = module.get<ScraperService>(ScraperService);
  });

  // ─── matchesAlert ───────────────────────────────────────────────────────────

  describe('matchesAlert', () => {
    const match = (whisky: Partial<SmwsLive>, alert: Partial<UserAlert>) =>
      (service as any).matchesAlert(whisky, alert);

    describe('distillery', () => {
      it('matches distillery name case-insensitively', () => {
        expect(match({ distillery: 'Glenfarclas', distilleryCode: '1' }, { alertType: 'distillery', alertValue: 'glenfarclas' })).toBe(true);
      });

      it('matches distillery name uppercase', () => {
        expect(match({ distillery: 'Glenfarclas', distilleryCode: '1' }, { alertType: 'distillery', alertValue: 'GLENFARCLAS' })).toBe(true);
      });

      it('matches distillery code', () => {
        expect(match({ distillery: 'Glenfarclas', distilleryCode: '1' }, { alertType: 'distillery', alertValue: '1' })).toBe(true);
      });

      it('returns false when neither name nor code matches', () => {
        expect(match({ distillery: 'Glenfarclas', distilleryCode: '1' }, { alertType: 'distillery', alertValue: 'Glenlivet' })).toBe(false);
      });

      it('returns false when both distillery and code are null', () => {
        expect(match({ distillery: null, distilleryCode: null }, { alertType: 'distillery', alertValue: 'Glenfarclas' })).toBe(false);
      });
    });

    describe('region', () => {
      it('matches region case-insensitively (lowercase value)', () => {
        expect(match({ region: 'Speyside' }, { alertType: 'region', alertValue: 'speyside' })).toBe(true);
      });

      it('matches region case-insensitively (uppercase value)', () => {
        expect(match({ region: 'Speyside' }, { alertType: 'region', alertValue: 'SPEYSIDE' })).toBe(true);
      });

      it('returns false on region mismatch', () => {
        expect(match({ region: 'Speyside' }, { alertType: 'region', alertValue: 'Highland' })).toBe(false);
      });

      it('returns false when region is null', () => {
        expect(match({ region: null }, { alertType: 'region', alertValue: 'Speyside' })).toBe(false);
      });
    });

    describe('age', () => {
      it('returns true when whisky age exceeds minimum', () => {
        expect(match({ age: '12 years' }, { alertType: 'age', alertValue: '10' })).toBe(true);
      });

      it('returns true at exact boundary (equal ages)', () => {
        expect(match({ age: '10' }, { alertType: 'age', alertValue: '10' })).toBe(true);
      });

      it('returns false when whisky age is below minimum', () => {
        expect(match({ age: '9' }, { alertType: 'age', alertValue: '10' })).toBe(false);
      });

      it('returns false when age string is empty', () => {
        expect(match({ age: '' }, { alertType: 'age', alertValue: '10' })).toBe(false);
      });

      it('returns false when age is null', () => {
        expect(match({ age: null }, { alertType: 'age', alertValue: '10' })).toBe(false);
      });

      it('returns false when alertValue is not a number', () => {
        expect(match({ age: '12' }, { alertType: 'age', alertValue: 'abc' })).toBe(false);
      });

      it('returns false when age is non-numeric string (NAS)', () => {
        expect(match({ age: 'NAS' }, { alertType: 'age', alertValue: '10' })).toBe(false);
      });

      it('parses "12 years" correctly via parseInt', () => {
        // parseInt('12 years') = 12 — this is intentional behaviour
        expect(match({ age: '12 years' }, { alertType: 'age', alertValue: '12' })).toBe(true);
      });
    });

    describe('unknown type', () => {
      it('returns false for unrecognised alertType', () => {
        expect(match({ distillery: 'Glenfarclas' }, { alertType: 'unknown', alertValue: 'anything' })).toBe(false);
      });
    });
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
      // The service uses TypeORM In() operator, so we just verify findBy was called once
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

  // ─── checkAlertsAndNotify ────────────────────────────────────────────────────

  describe('checkAlertsAndNotify', () => {
    it('returns early without calling getAllAlerts when newWhiskies is empty', async () => {
      await (service as any).checkAlertsAndNotify([]);
      expect(discordService.getAllAlerts).not.toHaveBeenCalled();
    });

    it('does not send notifications when getAllAlerts returns empty', async () => {
      discordService.getAllAlerts.mockResolvedValue([]);
      await (service as any).checkAlertsAndNotify([makeSmwsLive()]);
      expect(discordService.sendAlertNotification).not.toHaveBeenCalled();
    });

    it('sends a notification for each matching whisky+alert pair', async () => {
      const w1 = makeSmwsLive({ distillery: 'Glenfarclas' });
      const w2 = makeSmwsLive({ distillery: 'Glenfarclas', fullCode: '1.200', name: 'Second Dram' });
      const alert = makeUserAlert({ alertType: 'distillery', alertValue: 'Glenfarclas' });
      discordService.getAllAlerts.mockResolvedValue([alert]);
      await (service as any).checkAlertsAndNotify([w1, w2]);
      expect(discordService.sendAlertNotification).toHaveBeenCalledTimes(2);
    });

    it('does not send notification for non-matching pairs', async () => {
      const whisky = makeSmwsLive({ distillery: 'Glenfarclas' });
      const alert = makeUserAlert({ alertType: 'distillery', alertValue: 'Glenlivet' });
      discordService.getAllAlerts.mockResolvedValue([alert]);
      await (service as any).checkAlertsAndNotify([whisky]);
      expect(discordService.sendAlertNotification).not.toHaveBeenCalled();
    });

    it('sends correct number with 2 whiskies × 2 matching alerts', async () => {
      const w1 = makeSmwsLive({ region: 'Speyside' });
      const w2 = makeSmwsLive({ region: 'Speyside', fullCode: '1.200', name: 'Another' });
      const a1 = makeUserAlert({ alertType: 'region', alertValue: 'Speyside', userId: 'u1' });
      const a2 = makeUserAlert({ alertType: 'region', alertValue: 'Speyside', userId: 'u2' });
      discordService.getAllAlerts.mockResolvedValue([a1, a2]);
      await (service as any).checkAlertsAndNotify([w1, w2]);
      expect(discordService.sendAlertNotification).toHaveBeenCalledTimes(4);
    });
  });

  // ─── testAlertsWithExistingData ──────────────────────────────────────────────

  describe('testAlertsWithExistingData', () => {
    it('returns { checked: 0, matched: 0 } when getAllAlerts returns empty', async () => {
      liveRepo.find!.mockResolvedValue([makeSmwsLive()]);
      discordService.getAllAlerts.mockResolvedValue([]);
      const result = await service.testAlertsWithExistingData();
      expect(result).toEqual({ checked: 0, matched: 0 });
    });

    it('returns correct checked and matched counts', async () => {
      const whisky = makeSmwsLive({ distillery: 'Glenfarclas' });
      liveRepo.find!.mockResolvedValue([whisky]);
      const alert = makeUserAlert({ alertType: 'distillery', alertValue: 'Glenfarclas' });
      discordService.getAllAlerts.mockResolvedValue([alert]);
      const result = await service.testAlertsWithExistingData();
      expect(result.checked).toBe(1);
      expect(result.matched).toBe(1);
    });

    it('calls sendAlertNotification for matching pairs', async () => {
      const whisky = makeSmwsLive({ distillery: 'Glenfarclas' });
      liveRepo.find!.mockResolvedValue([whisky]);
      const alert = makeUserAlert({ alertType: 'distillery', alertValue: 'Glenfarclas' });
      discordService.getAllAlerts.mockResolvedValue([alert]);
      await service.testAlertsWithExistingData();
      expect(discordService.sendAlertNotification).toHaveBeenCalledTimes(1);
    });
  });

  // ─── runScraper smoke test ───────────────────────────────────────────────────

  describe('runScraper (smoke)', () => {
    beforeEach(() => {
      // Bypass all delay() calls so the empty-page retry doesn't stall tests
      jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);
      liveRepo.find!.mockResolvedValue([]);
    });

    it('calls liveRepo.find to fetch existing whiskies', async () => {
      await service.runScraper();
      expect(liveRepo.find).toHaveBeenCalled();
    });

    it('skips getAllAlerts when there are no new whiskies to check', async () => {
      // With evaluate() mocked to return [], there are no new whiskies, so
      // checkAlertsAndNotify([]) returns early before calling getAllAlerts
      await service.runScraper();
      expect(discordService.getAllAlerts).not.toHaveBeenCalled();
    });

    it('does not throw with all dependencies mocked', async () => {
      await expect(service.runScraper()).resolves.not.toThrow();
    });
  });
});
