/**
 * Runs jobs one at a time with at least `minIntervalMs` between the *start*
 * of consecutive jobs. Used to honour Nominatim's 1 request/second policy for
 * the whole server, regardless of how many clients are asking.
 */
export class SerialRateLimiter {
  private queue: Promise<unknown> = Promise.resolve();
  private lastStart: number | null = null;

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  schedule<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (this.lastStart !== null) {
        const wait = this.lastStart + this.minIntervalMs - this.now();
        if (wait > 0) await this.sleep(wait);
      }
      this.lastStart = this.now();
      return job();
    });
    // Keep the chain alive even if a job rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }
}
