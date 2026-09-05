import { Test } from '@nestjs/testing';
import {
  TastingAggregatesController,
  TastingsController,
} from './tastings.controller';
import { TastingsService } from './tastings.service';
import { TASTING_ID, USER_ID } from '../test-utils/fixtures';
import type { TasteepAuthRequest } from '../auth/tasteep-jwt-auth.guard';

const req = { user: { sub: USER_ID, sid: 'sid' } } as TasteepAuthRequest;

describe('Tasteep tastings controllers', () => {
  let tastings: TastingsController;
  let aggregates: TastingAggregatesController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn(),
      upsert: jest.fn(),
      remove: jest.fn(),
      updateLocation: jest.fn(),
      stats: jest
        .fn()
        .mockResolvedValue({
          count: 0,
          avg_score: null,
          distinct_distilleries: 0,
        }),
      cabinet: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      controllers: [TastingsController, TastingAggregatesController],
      providers: [{ provide: TastingsService, useValue: service }],
    }).compile();
    tastings = module.get(TastingsController);
    aggregates = module.get(TastingAggregatesController);
  });

  it('passes ?unplaced=true / 1 through and defaults to false', async () => {
    await tastings.list(req, 'true');
    await tastings.list(req, '1');
    await tastings.list(req, undefined);
    await tastings.list(req, 'no');
    expect(service.list.mock.calls.map((c) => c[1].unplaced)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(service.list.mock.calls[0][0]).toBe(USER_ID);
  });

  it('routes upsert, delete and location to the service with the user id', async () => {
    const dto = { name: 'x' };
    await tastings.upsert(req, TASTING_ID, dto);
    await tastings.remove(req, TASTING_ID);
    await tastings.updateLocation(req, TASTING_ID, {
      lat: 1,
      lon: 2,
      precision: 'manual',
    });
    expect(service.upsert).toHaveBeenCalledWith(USER_ID, TASTING_ID, dto);
    expect(service.remove).toHaveBeenCalledWith(USER_ID, TASTING_ID);
    expect(service.updateLocation).toHaveBeenCalledWith(USER_ID, TASTING_ID, {
      lat: 1,
      lon: 2,
      precision: 'manual',
    });
  });

  it('exposes stats and cabinet under /tasteep', async () => {
    await aggregates.stats(req);
    await aggregates.cabinet(req);
    expect(service.stats).toHaveBeenCalledWith(USER_ID);
    expect(service.cabinet).toHaveBeenCalledWith(USER_ID);
  });
});
