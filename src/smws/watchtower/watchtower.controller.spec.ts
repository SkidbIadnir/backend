import { Test, TestingModule } from '@nestjs/testing';
import { WatchtowerController } from './watchtower.controller';
import { WatchtowerService } from './watchtower.service';
import { makeSmwsLive } from '../test-utils/fixtures';

describe('WatchtowerController', () => {
  let controller: WatchtowerController;
  let service: {
    getAllLiveEntries: jest.Mock;
    getAllArchiveEntries: jest.Mock;
  };

  beforeEach(async () => {
    service = { getAllLiveEntries: jest.fn(), getAllArchiveEntries: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WatchtowerController],
      providers: [{ provide: WatchtowerService, useValue: service }],
    }).compile();

    controller = module.get<WatchtowerController>(WatchtowerController);
  });

  describe('GET /watchtower/live', () => {
    it('delegates to watchtowerService.getAllLiveEntries', async () => {
      service.getAllLiveEntries.mockResolvedValue([]);
      await controller.getLiveEntries();
      expect(service.getAllLiveEntries).toHaveBeenCalledTimes(1);
    });

    it('returns the result from the service', async () => {
      const entries = [makeSmwsLive()];
      service.getAllLiveEntries.mockResolvedValue(entries);
      const result = await controller.getLiveEntries();
      expect(result).toEqual(entries);
    });
  });

  describe('GET /smws/watchtower/archive', () => {
    it('delegates to watchtowerService.getAllArchiveEntries', async () => {
      service.getAllArchiveEntries.mockResolvedValue([{ id: 7 }]);
      expect(await controller.getArchiveEntries()).toEqual([{ id: 7 }]);
    });
  });
});
