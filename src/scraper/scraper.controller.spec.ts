jest.mock('playwright', () => ({
  firefox: { launch: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';

describe('ScraperController', () => {
  let controller: ScraperController;
  let service: {
    runScraper: jest.Mock;
    runArchiveScraper: jest.Mock;
    testAlertsWithExistingData: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      runScraper: jest.fn().mockResolvedValue(undefined),
      runArchiveScraper: jest.fn().mockResolvedValue(undefined),
      testAlertsWithExistingData: jest.fn().mockResolvedValue({ checked: 0, matched: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScraperController],
      providers: [{ provide: ScraperService, useValue: service }],
    }).compile();

    controller = module.get<ScraperController>(ScraperController);
  });

  describe('GET /scraper/run-live', () => {
    it('delegates to scraperService.runScraper', async () => {
      await controller.runLiveScraper();
      expect(service.runScraper).toHaveBeenCalledTimes(1);
    });

    it('returns a message confirming completion', async () => {
      const result = await controller.runLiveScraper();
      expect(result).toEqual({ message: 'Live scraper completed' });
    });
  });

  describe('GET /scraper/run-archive', () => {
    it('delegates to scraperService.runArchiveScraper', async () => {
      await controller.runArchiveScraper();
      expect(service.runArchiveScraper).toHaveBeenCalledTimes(1);
    });

    it('returns a message confirming completion', async () => {
      const result = await controller.runArchiveScraper();
      expect(result).toEqual({ message: 'Archive scraper completed' });
    });
  });

  describe('GET /scraper/test-alerts', () => {
    it('delegates to scraperService.testAlertsWithExistingData', async () => {
      await controller.testAlerts();
      expect(service.testAlertsWithExistingData).toHaveBeenCalledTimes(1);
    });

    it('wraps the service result in { message, result }', async () => {
      service.testAlertsWithExistingData.mockResolvedValue({ checked: 5, matched: 2 });
      const result = await controller.testAlerts();
      expect(result).toEqual({
        message: 'Alert test completed',
        result: { checked: 5, matched: 2 },
      });
    });
  });
});
