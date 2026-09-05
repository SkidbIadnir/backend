import { SerialRateLimiter } from './rate-limiter';

describe('SerialRateLimiter', () => {
  it('spaces job starts by at least the minimum interval and runs them in order', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = new SerialRateLimiter(
      1000,
      () => clock,
      async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    );
    const order: string[] = [];

    const results = await Promise.all([
      limiter.schedule(async () => (order.push('a'), 'A')),
      limiter.schedule(async () => (order.push('b'), 'B')),
      limiter.schedule(async () => (order.push('c'), 'C')),
    ]);

    expect(results).toEqual(['A', 'B', 'C']);
    expect(order).toEqual(['a', 'b', 'c']);
    // First job starts immediately; the next two each wait the full interval.
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('keeps serving after a job rejects', async () => {
    const limiter = new SerialRateLimiter(0);
    await expect(
      limiter.schedule(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(limiter.schedule(async () => 'ok')).resolves.toBe('ok');
  });
});
