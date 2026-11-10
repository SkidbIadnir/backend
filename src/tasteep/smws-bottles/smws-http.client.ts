import { Injectable, Logger } from '@nestjs/common';
import { SerialRateLimiter } from '../geocode/rate-limiter';
import { tasteepConfig } from '../tasteep-config';
import { normalizeProductUrl, SMWS_BASE_URL } from './smws-bottle.parse';
import { parseSitemap } from './smws-product.parser';

const TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 10_000;

export interface PageResponse {
  status: number;
  /** Body for 2xx answers, `null` otherwise. */
  body: string | null;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Every request to smws.eu: plain HTTP, one at a time, at least
 * `TASTEEP_SMWS_REQUEST_INTERVAL_MS` (default 3 s) apart for the whole
 * process. Only public, crawlable pages: the sitemap and product pages.
 */
@Injectable()
export class SmwsHttpClient {
  private readonly logger = new Logger(SmwsHttpClient.name);
  private readonly limiter = new SerialRateLimiter(
    tasteepConfig.smwsRequestIntervalMs,
  );

  /**
   * One page. 404/410 resolve with that status; network errors, timeouts and
   * 5xx are retried once after 10 s, then thrown.
   */
  async get(url: string): Promise<PageResponse> {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.limiter.schedule(() => this.fetchOnce(url));
        if (res.status >= 500 && attempt === 1) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res;
      } catch (error) {
        if (attempt >= 2) throw error;
        this.logger.warn(
          `${url}: ${(error as Error).message}, retrying in ${RETRY_DELAY_MS / 1000}s`,
        );
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  /** Every product URL in the sitemap, normalized and de-duplicated. Throws if none can be read. */
  async productUrls(): Promise<string[]> {
    const index = await this.get(`${SMWS_BASE_URL}/xmlsitemap.php`);
    if (!index.body) throw new Error(`Sitemap index answered ${index.status}`);
    const children = parseSitemap(index.body).sitemaps.filter((u) =>
      /type=products/.test(u),
    );
    if (!children.length)
      throw new Error('Sitemap index lists no product sitemap');

    const urls = new Set<string>();
    for (const child of children) {
      const page = await this.get(child);
      if (!page.body) throw new Error(`${child} answered ${page.status}`);
      for (const loc of parseSitemap(page.body).urls) {
        const url = normalizeProductUrl(loc);
        if (url) urls.add(url);
      }
    }
    return [...urls];
  }

  private async fetchOnce(url: string): Promise<PageResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': tasteepConfig.smwsUserAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      const body = res.ok ? await res.text() : null;
      if (!res.ok) await res.body?.cancel();
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
}
