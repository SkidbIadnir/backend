import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GeocodeService, normalizeQuery } from './geocode.service';
import { NominatimClient } from './nominatim.client';
import { SerialRateLimiter } from './rate-limiter';
import { TasteepGeocodeCache } from '../entities/tasteep-geocode-cache.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';

describe('normalizeQuery', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normalizeQuery('  Lagavulin   Distillery ')).toBe(
      'lagavulin distillery',
    );
  });
});

describe('GeocodeService', () => {
  let service: GeocodeService;
  let cache: MockRepository<TasteepGeocodeCache>;
  let nominatim: { search: jest.Mock };
  let limiter: SerialRateLimiter;

  beforeEach(() => {
    cache = createMockRepository<TasteepGeocodeCache>();
    cache.save!.mockImplementation(async (row: TasteepGeocodeCache) => row);
    nominatim = { search: jest.fn() };
    limiter = new SerialRateLimiter(0);
    jest.spyOn(limiter, 'schedule');
    service = new GeocodeService(
      cache as never,
      nominatim as unknown as NominatimClient,
      limiter,
    );
  });

  it('rejects an empty query', async () => {
    await expect(service.resolve('   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('serves a cache hit without calling Nominatim', async () => {
    cache.findOne!.mockResolvedValue({
      query: 'islay',
      lat: 55.7,
      lon: -6.2,
      precision: 'region',
    });
    expect(await service.resolve(' Islay ')).toEqual({
      lat: 55.7,
      lon: -6.2,
      precision: 'region',
    });
    expect(cache.findOne).toHaveBeenCalledWith({ where: { query: 'islay' } });
    expect(nominatim.search).not.toHaveBeenCalled();
  });

  it('404s on a cached miss without re-querying', async () => {
    cache.findOne!.mockResolvedValue({
      query: 'nowhere',
      lat: null,
      lon: null,
      precision: 'unknown',
    });
    await expect(service.resolve('nowhere')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(nominatim.search).not.toHaveBeenCalled();
  });

  it('goes through the rate limiter on a miss and caches the hit', async () => {
    cache.findOne!.mockResolvedValue(null);
    nominatim.search.mockResolvedValue({
      lat: 55.7,
      lon: -6.2,
      precision: 'exact',
    });

    const result = await service.resolve('Lagavulin');

    expect(limiter.schedule).toHaveBeenCalledTimes(1);
    expect(nominatim.search).toHaveBeenCalledWith('lagavulin');
    expect(cache.save).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'lagavulin',
        lat: 55.7,
        lon: -6.2,
        precision: 'exact',
        provider: 'nominatim',
      }),
    );
    expect(result).toEqual({ lat: 55.7, lon: -6.2, precision: 'exact' });
  });

  it('caches a Nominatim miss as unknown and 404s', async () => {
    cache.findOne!.mockResolvedValue(null);
    nominatim.search.mockResolvedValue(null);
    await expect(service.resolve('atlantis')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(cache.save).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'atlantis',
        lat: null,
        lon: null,
        precision: 'unknown',
      }),
    );
  });

  it('shares one upstream request between identical in-flight queries', async () => {
    cache.findOne!.mockResolvedValue(null);
    let release!: (v: unknown) => void;
    nominatim.search.mockReturnValue(new Promise((r) => (release = r)));

    const a = service.resolve('islay');
    const b = service.resolve('Islay');
    release({ lat: 1, lon: 2, precision: 'region' });

    expect(await Promise.all([a, b])).toEqual([
      { lat: 1, lon: 2, precision: 'region' },
      { lat: 1, lon: 2, precision: 'region' },
    ]);
    expect(nominatim.search).toHaveBeenCalledTimes(1);
  });
});
