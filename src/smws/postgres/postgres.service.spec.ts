import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PostgresService } from './postgres.service';
import { SmwsDistillery } from '../entities/smws-distillery.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';

describe('PostgresService', () => {
  let service: PostgresService;
  let distilleryRepo: MockRepository<SmwsDistillery>;
  let mockDataSource: { query: jest.Mock };

  beforeEach(async () => {
    distilleryRepo = createMockRepository<SmwsDistillery>();
    mockDataSource = { query: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostgresService,
        { provide: DataSource, useValue: mockDataSource },
        {
          provide: getRepositoryToken(SmwsDistillery),
          useValue: distilleryRepo,
        },
      ],
    }).compile();

    service = module.get<PostgresService>(PostgresService);
  });

  // ─── populateDistilleries ────────────────────────────────────────────────────

  describe('populateDistilleries', () => {
    it('returns the existing count and skips upsert when table is not empty', async () => {
      distilleryRepo.count!.mockResolvedValue(150);

      const result = await service.populateDistilleries();

      expect(result).toBe(150);
      expect(distilleryRepo.upsert).not.toHaveBeenCalled();
    });

    it('calls upsert with entries from JSON when table is empty', async () => {
      distilleryRepo.count!.mockResolvedValue(0);
      distilleryRepo.upsert!.mockResolvedValue({
        identifiers: [],
        generatedMaps: [],
        raw: [],
      });

      await service.populateDistilleries();

      expect(distilleryRepo.upsert).toHaveBeenCalledTimes(1);
    });

    it('passes entries with the expected shape to upsert', async () => {
      distilleryRepo.count!.mockResolvedValue(0);
      distilleryRepo.upsert!.mockResolvedValue({
        identifiers: [],
        generatedMaps: [],
        raw: [],
      });

      await service.populateDistilleries();

      const entries: any[] = (distilleryRepo.upsert as jest.Mock).mock
        .calls[0][0];
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries.slice(0, 5)) {
        expect(entry).toMatchObject({
          smwsId: expect.any(String),
          distilleryName: expect.any(String),
          category: expect.any(String),
        });
      }
    });

    it('returns the number of entries upserted when table was empty', async () => {
      distilleryRepo.count!.mockResolvedValue(0);
      distilleryRepo.upsert!.mockResolvedValue({
        identifiers: [],
        generatedMaps: [],
        raw: [],
      });

      const result = await service.populateDistilleries();

      expect(result).toBeGreaterThan(0);
    });

    it('passes conflictPaths [smwsId, category] to upsert', async () => {
      distilleryRepo.count!.mockResolvedValue(0);
      distilleryRepo.upsert!.mockResolvedValue({
        identifiers: [],
        generatedMaps: [],
        raw: [],
      });

      await service.populateDistilleries();

      const options = (distilleryRepo.upsert as jest.Mock).mock.calls[0][1];
      expect(options).toMatchObject({ conflictPaths: ['smwsId', 'category'] });
    });
  });

  // ─── purgeTables ─────────────────────────────────────────────────────────────

  describe('purgeTables', () => {
    it('truncates all four tables', async () => {
      await service.purgeTables();
      expect(mockDataSource.query).toHaveBeenCalledTimes(4);
    });

    it('truncates smws_live with RESTART IDENTITY CASCADE', async () => {
      await service.purgeTables();
      expect(mockDataSource.query).toHaveBeenCalledWith(
        'TRUNCATE TABLE "smws_live" RESTART IDENTITY CASCADE',
      );
    });

    it('truncates smws_archive', async () => {
      await service.purgeTables();
      expect(mockDataSource.query).toHaveBeenCalledWith(
        'TRUNCATE TABLE "smws_archive" RESTART IDENTITY CASCADE',
      );
    });

    it('truncates smws_distilleries', async () => {
      await service.purgeTables();
      expect(mockDataSource.query).toHaveBeenCalledWith(
        'TRUNCATE TABLE "smws_distilleries" RESTART IDENTITY CASCADE',
      );
    });

    it('returns the purged table names and a message', async () => {
      const result = await service.purgeTables();
      expect(result.purged).toEqual([
        'smws_live',
        'smws_archive',
        'smws_lookout',
        'smws_distilleries',
      ]);
      expect(result.message).toContain('purged');
    });
  });

  // ─── ensureTablesExist ───────────────────────────────────────────────────────

  describe('ensureTablesExist', () => {
    it('returns distilleriesPopulated from populateDistilleries', async () => {
      distilleryRepo.count!.mockResolvedValue(100);

      const result = await service.ensureTablesExist();

      expect(result.distilleriesPopulated).toBe(100);
      expect(result.message).toBeDefined();
    });
  });
});
