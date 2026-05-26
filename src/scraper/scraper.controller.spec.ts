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
  };

  beforeEach(async () => {
    service = {
      runScraper: jest.fn().mockResolvedValue(undefined),
      runArchiveScraper: jest.fn().mockResolvedValue(undefined),
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
});
