import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  TastingAggregatesController,
  TastingsController,
} from './tastings.controller';
import { TastingsService } from './tastings.service';
import { SmwsMeService } from './smws-me.service';
import { TASTING_ID, USER_ID } from '../test-utils/fixtures';
import type { TasteepAuthRequest } from '../auth/tasteep-jwt-auth.guard';

const req = { user: { sub: USER_ID, sid: 'sid' } } as TasteepAuthRequest;

describe('Tasteep tastings controllers', () => {
  let tastings: TastingsController;
  let aggregates: TastingAggregatesController;
  let service: Record<string, jest.Mock>;
  const smwsMe = { forUser: jest.fn().mockResolvedValue({}) };

  beforeEach(async () => {
    service = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn(),
      upsert: jest.fn(),
      remove: jest.fn(),
      updateLocation: jest.fn(),
      setPhoto: jest.fn(),
      removePhoto: jest.fn(),
      stats: jest.fn().mockResolvedValue({
        count: 0,
        avg_score: null,
        distinct_distilleries: 0,
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [TastingsController, TastingAggregatesController],
      providers: [
        { provide: TastingsService, useValue: service },
        { provide: SmwsMeService, useValue: smwsMe },
      ],
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

  it('passes the SMWS bottle and distillery filters, trimmed', async () => {
    await tastings.list(req, undefined, ' 029311GX0700612 ', undefined);
    await tastings.list(req, undefined, undefined, '29');
    await tastings.list(req, undefined, '  ', '');
    expect(
      (service.list.mock.calls as [string, object][]).map((c) => c[1]),
    ).toEqual([
      {
        unplaced: false,
        smwsSku: '029311GX0700612',
        smwsDistillery: undefined,
      },
      { unplaced: false, smwsSku: undefined, smwsDistillery: '29' },
      { unplaced: false, smwsSku: undefined, smwsDistillery: undefined },
    ]);
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

  it('routes a photo upload and removal with the user id', async () => {
    const buffer = Buffer.from('jpeg bytes');
    await tastings.setPhoto(req, TASTING_ID, {
      buffer,
    } as Express.Multer.File);
    await tastings.removePhoto(req, TASTING_ID);
    expect(service.setPhoto).toHaveBeenCalledWith(USER_ID, TASTING_ID, buffer);
    expect(service.removePhoto).toHaveBeenCalledWith(USER_ID, TASTING_ID);
  });

  it('400s a photo upload without a file', () => {
    for (const file of [
      undefined,
      { buffer: Buffer.alloc(0) } as Express.Multer.File,
    ]) {
      expect(() => tastings.setPhoto(req, TASTING_ID, file)).toThrow(
        BadRequestException,
      );
    }
    expect(service.setPhoto).not.toHaveBeenCalled();
  });

  it('exposes stats under /tasteep', async () => {
    await aggregates.stats(req);
    expect(service.stats).toHaveBeenCalledWith(USER_ID);
  });

  it('exposes the SMWS progress of the signed-in user', async () => {
    await aggregates.smws(req);
    expect(smwsMe.forUser).toHaveBeenCalledWith(USER_ID);
  });
});
