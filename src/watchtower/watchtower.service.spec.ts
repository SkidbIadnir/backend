import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WatchtowerService } from './watchtower.service';
import { SmwsLive } from '../entities/smws-live.entity';
import { createMockRepository, MockRepository } from '../test-utils/mock-repository.factory';
import { makeSmwsLive } from '../test-utils/fixtures';

describe('WatchtowerService', () => {
  let service: WatchtowerService;
  let liveRepo: MockRepository<SmwsLive>;

  beforeEach(async () => {
    liveRepo = createMockRepository<SmwsLive>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WatchtowerService,
        { provide: getRepositoryToken(SmwsLive), useValue: liveRepo },
      ],
    }).compile();

    service = module.get<WatchtowerService>(WatchtowerService);
  });

  describe('getAllLiveEntries', () => {
    it('calls liveRepo.find with createdAt DESC order', async () => {
      liveRepo.find!.mockResolvedValue([]);
      await service.getAllLiveEntries();
      expect(liveRepo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
    });

    it('returns the array returned by liveRepo.find', async () => {
      const entries = [makeSmwsLive(), makeSmwsLive({ id: 2, fullCode: '1.200' })];
      liveRepo.find!.mockResolvedValue(entries);
      const result = await service.getAllLiveEntries();
      expect(result).toEqual(entries);
    });

    it('re-throws when liveRepo.find throws', async () => {
      liveRepo.find!.mockRejectedValue(new Error('DB unavailable'));
      await expect(service.getAllLiveEntries()).rejects.toThrow('DB unavailable');
    });
  });
});
