import { Test, TestingModule } from '@nestjs/testing';
import { PostgresController } from './postgres.controller';
import { PostgresService } from './postgres.service';

describe('PostgresController', () => {
  let controller: PostgresController;
  let service: { ensureTablesExist: jest.Mock; purgeTables: jest.Mock };

  beforeEach(async () => {
    service = {
      ensureTablesExist: jest.fn(),
      purgeTables: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostgresController],
      providers: [{ provide: PostgresService, useValue: service }],
    }).compile();

    controller = module.get<PostgresController>(PostgresController);
  });

  describe('GET /postgres/tables', () => {
    it('delegates to postgresService.ensureTablesExist', async () => {
      service.ensureTablesExist.mockResolvedValue({ distilleriesPopulated: 150, message: 'ok' });
      await controller.ensureTables();
      expect(service.ensureTablesExist).toHaveBeenCalledTimes(1);
    });

    it('returns the result from the service', async () => {
      const result = { distilleriesPopulated: 150, message: 'Distilleries data checked' };
      service.ensureTablesExist.mockResolvedValue(result);
      expect(await controller.ensureTables()).toEqual(result);
    });
  });

  describe('DELETE /postgres/tables/purge', () => {
    it('delegates to postgresService.purgeTables', async () => {
      service.purgeTables.mockResolvedValue({ purged: [], message: 'done' });
      await controller.purgeTables();
      expect(service.purgeTables).toHaveBeenCalledTimes(1);
    });

    it('returns the result from the service', async () => {
      const result = { purged: ['smws_live'], message: 'All tables have been purged successfully' };
      service.purgeTables.mockResolvedValue(result);
      expect(await controller.purgeTables()).toEqual(result);
    });
  });
});
