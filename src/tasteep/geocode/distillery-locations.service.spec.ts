import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  DistilleryLocationsService,
  seedRows,
  type DistillerySeedFile,
} from './distillery-locations.service';
import { TasteepDistilleryLocation } from '../entities/tasteep-distillery-location.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';
import { makeDistilleryLocation } from '../test-utils/fixtures';
import * as distilleryData from '../data/distillery-location.json';

describe('seedRows', () => {
  it('builds a row per distillery with a stable slug id', () => {
    const rows = seedRows({
      distilleries: [
        { name: 'Ardbeg', lat: 55.64, lon: -6.11, precision: 'exact' },
        { name: 'Glen Scotia', lat: 55.42, lon: -5.6, precision: 'exact' },
      ],
    });
    expect(rows).toEqual([
      {
        id: 'ardbeg',
        name: 'Ardbeg',
        lat: 55.64,
        lon: -6.11,
        precision: 'exact',
      },
      {
        id: 'glen-scotia',
        name: 'Glen Scotia',
        lat: 55.42,
        lon: -5.6,
        precision: 'exact',
      },
    ]);
  });

  it('the real seed file has unique ids and valid coordinates', () => {
    const rows = seedRows(distilleryData as DistillerySeedFile);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of rows) {
      expect(typeof r.lat).toBe('number');
      expect(typeof r.lon).toBe('number');
      expect(Math.abs(r.lat!)).toBeLessThanOrEqual(90);
      expect(Math.abs(r.lon!)).toBeLessThanOrEqual(180);
    }
    expect(ids).toEqual(expect.arrayContaining(['ardbeg']));
  });
});

describe('DistilleryLocationsService', () => {
  let service: DistilleryLocationsService;
  let repo: MockRepository<TasteepDistilleryLocation>;

  beforeEach(async () => {
    repo = createMockRepository<TasteepDistilleryLocation>();
    const module = await Test.createTestingModule({
      providers: [
        DistilleryLocationsService,
        {
          provide: getRepositoryToken(TasteepDistilleryLocation),
          useValue: repo,
        },
      ],
    }).compile();
    service = module.get(DistilleryLocationsService);
  });

  describe('seed', () => {
    it('upserts rows keyed on id', async () => {
      repo.upsert!.mockResolvedValue(undefined);
      const n = await service.seed({
        distilleries: [{ name: 'Ardbeg', lat: 1, lon: 2, precision: 'exact' }],
      });
      expect(n).toBe(1);
      expect(repo.upsert).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'ardbeg', name: 'Ardbeg' })],
        ['id'],
      );
    });

    it('skips the upsert when the seed file is empty', async () => {
      await service.seed({ distilleries: [] });
      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('match', () => {
    beforeEach(() => {
      repo.find!.mockResolvedValue([makeDistilleryLocation()]);
    });

    it('matches the distillery name alone', async () => {
      expect((await service.match('ardbeg'))?.id).toBe('ardbeg');
    });

    it('matches with a "·"-separated region suffix', async () => {
      expect((await service.match('ardbeg · islay'))?.id).toBe('ardbeg');
    });

    it('matches with a comma-separated region suffix', async () => {
      expect((await service.match('ardbeg, islay'))?.id).toBe('ardbeg');
    });

    it('does not match a different word that merely starts with the same letters', async () => {
      expect(await service.match('ardbegxyz')).toBeNull();
    });

    it('returns null for a name not in the table', async () => {
      expect(await service.match('glenfiddich')).toBeNull();
    });
  });
});
