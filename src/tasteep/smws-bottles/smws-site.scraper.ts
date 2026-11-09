import { Injectable, Logger } from '@nestjs/common';
import { firefox, Page } from 'playwright';
import { normalizeProductUrl, SMWS_BASE_URL } from './smws-bottle.parse';

/**
 * Everything that touches smws.eu: browser lifecycle, listing pagination and
 * the bottle page. No database access — `SmwsBottleSyncService` decides what
 * the results mean. Selectors are the ones the previous scraper used; this is
 * the part to rework when the site's structure is pinned down.
 */

const LISTING_URL = (page: number) =>
  `${SMWS_BASE_URL}/all-whisky?min-price=0&max-price=0&sort=newest&per-page=16&filter-page=${page}`;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0';
const EMPTY_PAGE_RETRY_DELAY_MS = 10_000;
const PAGE_ERROR_RETRY_DELAY_MS = 5_000;
const MAX_PAGE_ERROR_RETRIES = 2;
/** Hard stop in case the site never returns an empty page. */
const MAX_PAGES = 200;

export interface ListedProducts {
  /** Distinct normalized product URLs, in listing order. */
  urls: string[];
  pages: number;
  /** False when a page kept failing and pagination was cut short. */
  complete: boolean;
}

/** Raw fields of a bottle page; parsing into numbers happens in the sync service. */
export interface ScrapedBottle {
  code: string;
  name: string;
  priceText: string;
  abvText: string;
  age: string;
  caskType: string;
  profile: string;
  regionText: string;
}

export interface SmwsSiteSession {
  listProducts(): Promise<ListedProducts>;
  /** `null` when the page has no SMWS cask code (gift sets, events, blends…). Throws on navigation errors. */
  readBottle(url: string): Promise<ScrapedBottle | null>;
  close(): Promise<void>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class SmwsSiteScraper {
  private readonly logger = new Logger(SmwsSiteScraper.name);

  /** Launches a browser for one run; the caller must `close()` it. */
  async open(): Promise<SmwsSiteSession> {
    const browser = await firefox.launch({ headless: true });
    try {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        userAgent: USER_AGENT,
      });
      const page = await context.newPage();
      await page.goto(LISTING_URL(1), {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await this.handleModals(page);
      return {
        listProducts: () => this.listProducts(page),
        readBottle: (url) => this.readBottle(page, url),
        close: () => browser.close(),
      };
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  private async handleModals(page: Page): Promise<void> {
    await delay(2000);
    try {
      await page.locator('label[for="ageCheckbox"]').click({ timeout: 3000 });
    } catch {
      this.logger.debug('No age verification found or already confirmed');
    }
    try {
      await page
        .getByRole('button', {
          name: /accept all cookies|accept all|accept cookies|accept/i,
        })
        .click({ timeout: 3000 });
    } catch {
      this.logger.debug('No cookie modal found or already accepted');
    }
    await delay(1000);
  }

  private extractCards(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const container = document.querySelector('#product-listing-container');
      if (!container) return [];
      return Array.from(container.querySelectorAll('.card-title a')).map(
        (card) => card.getAttribute('href') || '',
      );
    });
  }

  private async listProducts(page: Page): Promise<ListedProducts> {
    const urls = new Set<string>();
    let pageNumber = 1;
    let complete = true;

    while (pageNumber <= MAX_PAGES) {
      let hrefs: string[] | null = null;
      for (let attempt = 0; hrefs === null; attempt++) {
        try {
          if (pageNumber > 1) {
            await page.goto(LISTING_URL(pageNumber), {
              waitUntil: 'domcontentloaded',
              timeout: 45_000,
            });
          }
          await page.waitForSelector('#product-listing-container', {
            timeout: 15_000,
          });
          await delay(2000);
          hrefs = await this.extractCards(page);
          if (hrefs.length === 0) {
            this.logger.warn(
              `Listing page ${pageNumber} returned 0 products, retrying once.`,
            );
            await delay(EMPTY_PAGE_RETRY_DELAY_MS);
            hrefs = await this.extractCards(page);
          }
        } catch (error) {
          if (attempt >= MAX_PAGE_ERROR_RETRIES) {
            this.logger.error(
              `Giving up on listing page ${pageNumber}: ${(error as Error).message}`,
            );
            complete = false;
            hrefs = [];
            break;
          }
          await delay(PAGE_ERROR_RETRY_DELAY_MS);
        }
      }
      // An empty page ends the listing. A falsely empty page (bot block, CDN
      // hiccup) is caught later by the sync's short-listing check.
      if (!complete || !hrefs?.length) break;

      for (const href of hrefs) {
        const url = normalizeProductUrl(href);
        if (url) urls.add(url);
      }
      this.logger.log(
        `Listing page ${pageNumber}: ${hrefs.length} cards (${urls.size} distinct so far)`,
      );
      pageNumber++;
    }
    if (pageNumber > MAX_PAGES) {
      this.logger.error(`Stopped after ${MAX_PAGES} listing pages.`);
      complete = false;
    }

    return { urls: [...urls], pages: pageNumber - 1, complete };
  }

  private async readBottle(
    page: Page,
    url: string,
  ): Promise<ScrapedBottle | null> {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector('.productView-details', { timeout: 15_000 });
    await delay(500);

    return page.evaluate(() => {
      const getText = (selector: string) =>
        document.querySelector(selector)?.textContent?.trim() || '';
      const getInfoValue = (infoName: string) => {
        for (const item of document.querySelectorAll('.productView-info li')) {
          const name = item
            .querySelector('.productView-info-name')
            ?.textContent?.trim()
            .toUpperCase();
          if (name === infoName.toUpperCase()) {
            return (
              item
                .querySelector('.productView-info-value')
                ?.textContent?.trim() || ''
            );
          }
        }
        return '';
      };

      // Scoped to .productView-details so the "You might also like" cards
      // further down cannot supply the code.
      const code =
        document.querySelector('.productView-details .caskNo')?.textContent ||
        '';
      if (!/[A-Za-z]*\d+\.\d+/.test(code)) return null;

      return {
        code,
        name: getText('.productView-title'),
        priceText: getText('.price--withTax'),
        abvText: getInfoValue('ABV'),
        age: getInfoValue('Age'),
        caskType: getInfoValue('CASK TYPE'),
        profile: getInfoValue('PROFILE'),
        regionText: getInfoValue('REGION'),
      };
    });
  }
}
