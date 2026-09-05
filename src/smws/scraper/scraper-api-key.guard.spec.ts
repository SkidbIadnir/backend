import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ScraperApiKeyGuard } from './scraper-api-key.guard';

const ctx = (key?: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ header: () => key }) }),
  }) as unknown as ExecutionContext;

describe('ScraperApiKeyGuard', () => {
  const guard = new ScraperApiKeyGuard();

  afterEach(() => delete process.env.SMWS_SCRAPER_API_KEY);

  it('disables manual runs when no key is configured', () => {
    expect(() => guard.canActivate(ctx('anything'))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a missing or wrong key', () => {
    process.env.SMWS_SCRAPER_API_KEY = 'secret';
    expect(() => guard.canActivate(ctx())).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx('nope'))).toThrow(ForbiddenException);
  });

  it('accepts the configured key', () => {
    process.env.SMWS_SCRAPER_API_KEY = 'secret';
    expect(guard.canActivate(ctx('secret'))).toBe(true);
  });
});
