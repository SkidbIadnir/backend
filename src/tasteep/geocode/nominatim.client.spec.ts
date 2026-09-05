import { HttpService } from '@nestjs/axios';
import { ServiceUnavailableException } from '@nestjs/common';
import { of } from 'rxjs';
import { NominatimClient, precisionFromResult } from './nominatim.client';

describe('precisionFromResult', () => {
  it('maps Nominatim place kinds onto the app scale', () => {
    expect(precisionFromResult({ addresstype: 'country' })).toBe('country');
    expect(precisionFromResult({ addresstype: 'state' })).toBe('region');
    expect(precisionFromResult({ addresstype: 'county' })).toBe('region');
    expect(precisionFromResult({ addresstype: 'island' })).toBe('region');
    expect(precisionFromResult({ addresstype: 'city' })).toBe('exact');
    expect(precisionFromResult({ addresstype: 'industrial' })).toBe('exact');
    expect(precisionFromResult({ type: 'country' })).toBe('country');
    expect(precisionFromResult({})).toBe('exact');
  });
});

describe('NominatimClient', () => {
  let http: { get: jest.Mock };
  let client: NominatimClient;

  beforeEach(() => {
    http = { get: jest.fn() };
    client = new NominatimClient(http as unknown as HttpService);
    process.env.TASTEEP_NOMINATIM_USER_AGENT =
      'Tasteep/test (test@example.com)';
  });

  it('refuses to call Nominatim without an identifying User-Agent', async () => {
    delete process.env.TASTEEP_NOMINATIM_USER_AGENT;
    await expect(client.search('islay')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(http.get).not.toHaveBeenCalled();
  });

  it('sends the policy headers and parses the first hit', async () => {
    http.get.mockReturnValue(
      of({ data: [{ lat: '55.75', lon: '-6.25', addresstype: 'island' }] }),
    );

    const hit = await client.search('islay');

    expect(hit).toEqual({ lat: 55.75, lon: -6.25, precision: 'region' });
    const [url, options] = http.get.mock.calls[0];
    expect(url).toBe('https://nominatim.openstreetmap.org/search');
    expect(options.headers['User-Agent']).toBe(
      'Tasteep/test (test@example.com)',
    );
    expect(options.params).toMatchObject({
      q: 'islay',
      format: 'jsonv2',
      limit: 1,
    });
  });

  it('returns null on no results or garbage coordinates', async () => {
    http.get.mockReturnValueOnce(of({ data: [] }));
    expect(await client.search('nowhere')).toBeNull();
    http.get.mockReturnValueOnce(of({ data: [{ lat: 'x', lon: 'y' }] }));
    expect(await client.search('garbage')).toBeNull();
  });
});
