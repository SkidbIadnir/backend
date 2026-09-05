import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Protects the manual scraper triggers. The caller must send
 * `x-api-key: <SMWS_SCRAPER_API_KEY>`. When the variable is unset the manual
 * endpoints are disabled entirely and only the cron schedule runs the scraper.
 */
@Injectable()
export class ScraperApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.SMWS_SCRAPER_API_KEY;
    if (!expected) {
      throw new ForbiddenException(
        'Manual scraper runs are disabled (SMWS_SCRAPER_API_KEY not set).',
      );
    }
    const header =
      context.switchToHttp().getRequest<Request>().header('x-api-key') ?? '';
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid API key.');
    }
    return true;
  }
}
