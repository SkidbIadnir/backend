import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HEALTH_DB_TIMEOUT_MS, HealthController } from './health.controller';

describe('HealthController', () => {
  const make = (query: jest.Mock) =>
    new HealthController({ query } as unknown as DataSource);

  afterEach(() => jest.useRealTimers());

  it('returns ok when the database answers', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    await expect(make(query).check()).resolves.toEqual({ status: 'ok' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns 503 when the query fails', async () => {
    const query = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(make(query).check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns 503 when the database does not answer in time', async () => {
    jest.useFakeTimers();
    const query = jest.fn(() => new Promise(() => {}));
    const result = make(query).check();
    jest.advanceTimersByTime(HEALTH_DB_TIMEOUT_MS);
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
