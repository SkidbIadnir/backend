import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SmwsLive } from '../entities/smws-live.entity';
import { SmwsArchive } from '../entities/smws-archive.entity';
import { SmwsDistillery } from '../entities/smws-distillery.entity';
import { firefox, Browser, Page } from 'playwright';

export interface ScrapedWhiskyData {
  name: string;
  fullCode: string;
  distilleryId?: number | string;
  caskNo?: string;
  price: string;
  abv: string;
  age: string;
  caskType: string;
  profile: string;
  distillery: string;
  region: string;
  available: boolean;
  url: string;
}

export interface ScrapedArchiveWhiskyData {
  name: string;
  code: string;
  price: string;
  description: string;
  abv: string;
  age: string;
  caskType: string;
  distillery: string;
  region: string;
  bottleSize: string;
  url: string;
}

export interface ScrapedWhiskyListItem {
  title: string;
  href: string;
}

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private browser: Browser | null = null;
  private readonly emptyPageRetryDelayMs = 10000;
  private readonly pageErrorRetryDelayMs = 5000;
  private readonly maxPageErrorRetries = 2;
  private isLiveScraperRunning = false;
  private isArchiveScraperRunning = false;

  constructor(
    @InjectRepository(SmwsLive)
    private readonly liveRepo: Repository<SmwsLive>,
    @InjectRepository(SmwsArchive)
    private readonly archiveRepo: Repository<SmwsArchive>,
    @InjectRepository(SmwsDistillery)
    private readonly distilleryRepo: Repository<SmwsDistillery>,
  ) {}

  private async initBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.logger.log('Launching browser...');
      this.browser = await firefox.launch({ headless: true });
    }
    return this.browser;
  }

  private async closeBrowser(): Promise<void> {
    if (this.browser) {
      this.logger.log('Closing browser...');
      await this.browser.close();
      this.browser = null;
    }
  }

  private async handleModals(page: Page): Promise<void> {
    await this.delay(2000);

    try {
      await page.locator('label[for="ageCheckbox"]').click({ timeout: 3000 });
      this.logger.log('Age verification checked');
    } catch {
      this.logger.log('No age verification found or already confirmed');
    }

    try {
      await page
        .getByRole('button', {
          name: /accept all cookies|accept all|accept cookies|accept/i,
        })
        .click({ timeout: 3000 });
      this.logger.log('Cookie consent accepted');
    } catch {
      this.logger.log('No cookie modal found or already accepted');
    }

    await this.delay(1000);
  }

  /**
   * Generic paginated card collector — reused by live and archive scrapers.
   *
   * Returns `complete: false` when pagination was cut short by a scraping error
   * (network blip, selector timeout) after exhausting retries, as opposed to
   * genuinely running out of pages. Callers should treat an incomplete list as
   * a partial snapshot, not an authoritative "these items are all that exist"
   * result — e.g. skip destructive "mark missing items removed" logic.
   */
  private async collectAllPagesBasicInfo(
    page: Page,
    buildPageUrl: (pageNum: number) => string,
    logLabel: string,
  ): Promise<{ items: ScrapedWhiskyListItem[]; complete: boolean }> {
    this.logger.log(`Collecting ${logLabel} list from all pages...`);
    const allWhiskies: ScrapedWhiskyListItem[] = [];
    let currentPage = 1;
    let hasMorePages = true;
    let complete = true;

    const extractCards = () =>
      page.evaluate(() => {
        const container = document.querySelector('#product-listing-container');
        if (!container) return [];
        return Array.from(container.querySelectorAll('.card-title a')).map(
          (card) => ({
            title: card.textContent?.trim() || '',
            href: card.getAttribute('href') || '',
          }),
        );
      });

    while (hasMorePages) {
      this.logger.log(`Scraping ${logLabel} page ${currentPage}...`);

      let attempt = 0;
      let pageHandled = false;

      while (!pageHandled) {
        try {
          if (currentPage > 1) {
            await page.goto(buildPageUrl(currentPage), {
              waitUntil: 'domcontentloaded',
              timeout: 45000,
            });
          }

          await page.waitForSelector('#product-listing-container', {
            timeout: 15000,
          });
          await this.delay(2000);

          let pageWhiskies = await extractCards();

          if (pageWhiskies.length === 0) {
            this.logger.warn(
              `${logLabel} page ${currentPage} returned 0 products. Waiting ${this.emptyPageRetryDelayMs / 1000}s and retrying.`,
            );
            await this.delay(this.emptyPageRetryDelayMs);
            pageWhiskies = await extractCards();
          }

          if (pageWhiskies.length === 0) {
            this.logger.log(
              `No products on ${logLabel} page ${currentPage}. Reached end.`,
            );
            hasMorePages = false;
          } else {
            this.logger.log(
              `Found ${pageWhiskies.length} on ${logLabel} page ${currentPage}`,
            );
            allWhiskies.push(...pageWhiskies);
            currentPage++;
          }
          pageHandled = true;
        } catch (error) {
          attempt++;
          if (attempt > this.maxPageErrorRetries) {
            this.logger.error(
              `Giving up on ${logLabel} page ${currentPage} after ${attempt} attempts: ${error.message}. Treating this scrape as incomplete.`,
            );
            hasMorePages = false;
            complete = false;
            pageHandled = true;
          } else {
            this.logger.warn(
              `Error on ${logLabel} page ${currentPage} (attempt ${attempt}/${this.maxPageErrorRetries}): ${error.message}. Retrying in ${this.pageErrorRetryDelayMs / 1000}s.`,
            );
            await this.delay(this.pageErrorRetryDelayMs);
          }
        }
      }
    }

    this.logger.log(
      `${logLabel} total — pages: ${currentPage - 1}, whiskies: ${allWhiskies.length}, complete: ${complete}`,
    );
    return { items: allWhiskies, complete };
  }

  private async collectAllWhiskyBasicInfo(
    page: Page,
  ): Promise<{ items: ScrapedWhiskyListItem[]; complete: boolean }> {
    return this.collectAllPagesBasicInfo(
      page,
      (n) =>
        `https://smws.eu/all-whisky?min-price=0&max-price=0&sort=newest&per-page=16&filter-page=${n}`,
      'whisky',
    );
  }

  private async collectAllArchiveWhiskyBasicInfo(
    page: Page,
  ): Promise<{ items: ScrapedWhiskyListItem[]; complete: boolean }> {
    return this.collectAllPagesBasicInfo(
      page,
      (n) => `https://smws.eu/archive?page=${n}`,
      'archive whisky',
    );
  }

  private async scrapeWhiskyDetails(
    page: Page,
    whiskies: ScrapedWhiskyListItem[],
  ): Promise<ScrapedWhiskyData[]> {
    this.logger.log(`Starting detail scraping for ${whiskies.length} whiskies`);
    const detailedWhiskies: ScrapedWhiskyData[] = [];
    const baseUrl = 'https://smws.eu';

    for (let i = 0; i < whiskies.length; i++) {
      const whisky = whiskies[i];
      const url = whisky.href.startsWith('http')
        ? whisky.href
        : `${baseUrl}${whisky.href}`;
      this.logger.log(
        `[${i + 1}/${whiskies.length}] Scraping: ${whisky.title}`,
      );

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForSelector('.productView-details', { timeout: 15000 });
        await this.delay(500);

        const details = await page.evaluate(() => {
          const getText = (selector: string) =>
            document.querySelector(selector)?.textContent?.trim() || '';

          const getInfoValue = (infoName: string) => {
            const infoList = document.querySelectorAll('.productView-info li');
            for (const item of infoList) {
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

          // Scope to .productView-details to avoid picking up codes from the
          // "You might also like" cards rendered further down the page.
          // If no valid code is found this is not a regular bottling — return null to skip it.
          const rawCode =
            document.querySelector('.productView-details .caskNo')
              ?.textContent || '';
          const codeMatch = rawCode.match(/([A-Za-z]*\d+)\.(\d+)/);
          if (!codeMatch) return null;

          const fullCode = codeMatch[0];
          const codePart = codeMatch[1];
          const caskNo = codeMatch[2];
          const distilleryId = /^\d+$/.test(codePart)
            ? parseInt(codePart, 10)
            : codePart;

          return {
            name: getText('.productView-title'),
            fullCode,
            distilleryId,
            caskNo,
            price: getText('.price--withTax'),
            abv: getInfoValue('ABV'),
            age: getInfoValue('Age'),
            caskType: getInfoValue('CASK TYPE'),
            profile: getInfoValue('PROFILE'),
            region: getInfoValue('REGION'),
            distillery: '',
            available: true,
            url: window.location.href,
          };
        });

        if (details === null) {
          this.logger.log(
            `Skipping "${whisky.title}" — no valid SMWS code found (not a regular bottling)`,
          );
        } else if (details.name) {
          detailedWhiskies.push(details as ScrapedWhiskyData);
        }
      } catch (error) {
        this.logger.error(`Error scraping ${whisky.title}: ${error.message}`);
      }
    }

    this.logger.log(
      `Detail scraping complete — ${detailedWhiskies.length}/${whiskies.length} were regular bottlings`,
    );
    return detailedWhiskies;
  }

  async runScraper(): Promise<void> {
    if (this.isLiveScraperRunning) {
      this.logger.warn(
        'Live scraper run requested while a previous run is still in progress — skipping.',
      );
      return;
    }
    this.isLiveScraperRunning = true;
    this.logger.log('=== STARTING SMWS SCRAPER ===');

    const browser = await this.initBrowser();
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
    });
    const page = await context.newPage();

    try {
      this.logger.log('Step 1: Navigating to SMWS...');
      await page.goto('https://smws.eu/all-whisky', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await this.handleModals(page);

      this.logger.log('Step 2: Collecting whisky list...');
      const { items: allWhiskies, complete } =
        await this.collectAllWhiskyBasicInfo(page);

      this.logger.log('Step 3: Fetching existing whiskies from database...');
      const existingWhiskies = await this.getExistingWhiskiesFromDB();
      this.logger.log(
        `Found ${existingWhiskies.length} existing whiskies in database`,
      );

      this.logger.log('Step 4: Comparing with database...');
      const newWhiskies = this.findNewWhiskies(allWhiskies, existingWhiskies);
      const removedWhiskies = this.findRemovedWhiskies(
        allWhiskies,
        existingWhiskies,
      );
      const existingAvailableWhiskies = allWhiskies.filter(
        (scraped) =>
          scraped.href &&
          existingWhiskies.some((existing) => existing.href === scraped.href),
      );

      this.logger.log(
        `New: ${newWhiskies.length}, Removed: ${removedWhiskies.length}, Still available: ${existingAvailableWhiskies.length}`,
      );

      if (!complete) {
        this.logger.warn(
          'Whisky list collection did not complete cleanly (a page kept failing) — skipping the "mark removed as unavailable" step this run to avoid falsely marking still-listed whiskies unavailable.',
        );
      } else if (removedWhiskies.length > 0) {
        this.logger.log('Step 5: Marking removed whiskies as unavailable...');
        await this.markWhiskiesAsUnavailable(removedWhiskies);
      }

      if (existingAvailableWhiskies.length > 0) {
        this.logger.log('Step 6: Ensuring existing whiskies are available...');
        await this.markWhiskiesAsAvailable(existingAvailableWhiskies);
      }

      let savedWhiskies: SmwsLive[] = [];

      if (newWhiskies.length > 0) {
        this.logger.log(
          `Step 7: Scraping details for ${newWhiskies.length} new whiskies...`,
        );
        const scraped = await this.scrapeWhiskyDetails(page, newWhiskies);

        this.logger.log('Step 8: Saving new whiskies to database...');
        savedWhiskies = await this.saveWhiskiesToDatabase(scraped, true);
      } else {
        this.logger.log('Step 7: No new whiskies to scrape');
      }

      this.logger.log('Step 9: Updating isNew flags...');
      await this.updateIsNewFlags();

      this.logger.log(
        `=== SCRAPER COMPLETED — new: ${newWhiskies.length}, saved: ${savedWhiskies.length}, unavailable: ${removedWhiskies.length} ===`,
      );
    } catch (error) {
      this.logger.error(`Scraper error: ${error.message}`);
    } finally {
      await page.close();
      await context.close();
      await this.closeBrowser();
      this.isLiveScraperRunning = false;
    }
  }

  private async getExistingWhiskiesFromDB(): Promise<ScrapedWhiskyListItem[]> {
    try {
      const rows = await this.liveRepo.find({
        select: { name: true, url: true },
      });
      return rows.map((r) => ({ title: r.name, href: r.url ?? '' }));
    } catch (error) {
      this.logger.error('Error fetching existing whiskies:', error);
      return [];
    }
  }

  /**
   * Matched by product URL (`href`), not title — SMWS titles are free-text
   * descriptions that can collide or drift between scrapes of the same cask,
   * while the product URL is a stable identity. Items with no href can't be
   * confidently identified, so a missing href is treated as "new" (safe to
   * re-scrape) rather than silently matched against something else.
   */
  private findNewWhiskies(
    scrapedWhiskies: ScrapedWhiskyListItem[],
    existingWhiskies: ScrapedWhiskyListItem[],
  ): ScrapedWhiskyListItem[] {
    const existingHrefs = new Set(
      existingWhiskies.filter((w) => w.href).map((w) => w.href),
    );
    return scrapedWhiskies.filter((w) => !w.href || !existingHrefs.has(w.href));
  }

  /**
   * Matched by product URL (`href`) — see findNewWhiskies. An existing DB row
   * with no href is never considered "removed" since we have no reliable way
   * to confirm it's actually gone.
   */
  private findRemovedWhiskies(
    scrapedWhiskies: ScrapedWhiskyListItem[],
    existingWhiskies: ScrapedWhiskyListItem[],
  ): ScrapedWhiskyListItem[] {
    const scrapedHrefs = new Set(
      scrapedWhiskies.filter((w) => w.href).map((w) => w.href),
    );
    return existingWhiskies.filter((w) => w.href && !scrapedHrefs.has(w.href));
  }

  private async markWhiskiesAsUnavailable(
    whiskies: ScrapedWhiskyListItem[],
  ): Promise<void> {
    const urls = whiskies.map((w) => w.href).filter((href) => !!href);
    if (urls.length === 0) return;
    this.logger.log(`Marking ${urls.length} whiskies as unavailable`);
    await this.liveRepo
      .createQueryBuilder()
      .update()
      .set({ available: false })
      .where('url IN (:...urls)', { urls })
      .execute();
  }

  private async markWhiskiesAsAvailable(
    whiskies: ScrapedWhiskyListItem[],
  ): Promise<void> {
    const urls = whiskies.map((w) => w.href).filter((href) => !!href);
    if (urls.length === 0) return;
    this.logger.log(`Ensuring ${urls.length} whiskies are marked as available`);
    await this.liveRepo
      .createQueryBuilder()
      .update()
      .set({ available: true })
      .where('url IN (:...urls)', { urls })
      .execute();
  }

  private async updateIsNewFlags(): Promise<void> {
    this.logger.log('Updating isNew flags based on 3-day rule...');
    try {
      await this.liveRepo
        .createQueryBuilder()
        .update()
        .set({ isNew: false })
        .where(
          "is_new = true AND new_since IS NOT NULL AND new_since < NOW() - INTERVAL '3 days'",
        )
        .execute();
      this.logger.log('Updated isNew flags successfully');
    } catch (error) {
      this.logger.error('Error updating isNew flags:', error);
    }
  }

  async saveWhiskiesToDatabase(
    whiskies: ScrapedWhiskyData[],
    isNew: boolean = false,
  ): Promise<SmwsLive[]> {
    this.logger.log(`Saving ${whiskies.length} whiskies to database...`);

    // Batch-fetch all needed distillery names in a single query
    const missingIds = [
      ...new Set(
        whiskies
          .filter((w) => w.distilleryId && !w.distillery)
          .map((w) => w.distilleryId!.toString()),
      ),
    ];

    const distilleryMap = new Map<string, string>();
    if (missingIds.length > 0) {
      const rows = await this.distilleryRepo.findBy({ smwsId: In(missingIds) });
      for (const row of rows) {
        distilleryMap.set(row.smwsId, row.distilleryName);
      }
    }

    const savedCodes: string[] = [];

    for (const whisky of whiskies) {
      try {
        if (whisky.distilleryId && !whisky.distillery) {
          whisky.distillery =
            distilleryMap.get(whisky.distilleryId.toString()) || '';
        }

        const entity: Partial<SmwsLive> = {
          name: whisky.name,
          fullCode: whisky.fullCode,
          distilleryCode:
            whisky.distilleryId !== undefined && whisky.distilleryId !== null
              ? whisky.distilleryId.toString()
              : null,
          caskNo: whisky.caskNo || null,
          price: whisky.price || null,
          abv: whisky.abv || null,
          age: whisky.age || null,
          caskType: whisky.caskType || null,
          profile: whisky.profile || null,
          distillery: whisky.distillery || null,
          region: whisky.region || null,
          available: whisky.available,
          url: whisky.url || null,
          isNew,
          newSince: isNew ? new Date() : null,
        };

        await this.liveRepo.upsert(entity, {
          conflictPaths: ['fullCode'],
          skipUpdateIfNoValuesChanged: false,
        });

        savedCodes.push(whisky.fullCode);
      } catch (error) {
        this.logger.error(
          `Error saving whisky ${whisky.name} (${whisky.fullCode}): ${error.message}`,
        );
      }
    }

    // Batch-fetch the saved rows in a single query instead of one findOne per
    // whisky — the loop above still upserts one-by-one so a bad row doesn't
    // abort the whole batch, but the read-back only needs one round trip.
    const saved =
      savedCodes.length > 0
        ? await this.liveRepo.find({ where: { fullCode: In(savedCodes) } })
        : [];

    this.logger.log(`Saved ${saved.length}/${whiskies.length} whiskies`);
    return saved;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async takeScreenshot(url: string, filename: string): Promise<void> {
    const browser = await this.initBrowser();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    try {
      await page.goto(url);
      await page.screenshot({ path: filename, fullPage: true });
      this.logger.log(`Screenshot saved: ${filename}`);
    } finally {
      await page.close();
      await context.close();
      await this.closeBrowser();
    }
  }

  // ============================================
  // ARCHIVE SCRAPER
  // ============================================

  private async scrapeArchiveWhiskyDetails(
    page: Page,
    whiskies: ScrapedWhiskyListItem[],
  ): Promise<ScrapedArchiveWhiskyData[]> {
    this.logger.log(
      `Starting archive detail scraping for ${whiskies.length} whiskies`,
    );
    const detailedWhiskies: ScrapedArchiveWhiskyData[] = [];
    const baseUrl = 'https://smws.eu';

    for (let i = 0; i < whiskies.length; i++) {
      const whisky = whiskies[i];
      const url = whisky.href.startsWith('http')
        ? whisky.href
        : `${baseUrl}${whisky.href}`;
      this.logger.log(
        `[${i + 1}/${whiskies.length}] Scraping archive: ${whisky.title}`,
      );

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForSelector('.productView-details', { timeout: 15000 });
        await this.delay(500);

        const details = await page.evaluate(() => {
          const getText = (selector: string) =>
            document.querySelector(selector)?.textContent?.trim() || '';

          const getInfoValue = (infoName: string) => {
            const infoList = document.querySelectorAll('.productView-info li');
            for (const item of infoList) {
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

          const getPrice = () => {
            const scripts = document.querySelectorAll(
              'script[type="text/javascript"]',
            );
            for (const script of scripts) {
              const content = script.textContent || '';
              if (content.includes('var BCData')) {
                try {
                  const match = content.match(/var BCData = ({.*?});/s);
                  if (match) {
                    const bcData = JSON.parse(match[1]);
                    const priceData =
                      bcData?.product_attributes?.price?.with_tax;
                    if (priceData?.formatted) return priceData.formatted;
                  }
                } catch (e) {
                  console.error('Error parsing BCData:', e);
                }
              }
            }
            return '';
          };

          const rawArchiveCode =
            document.querySelector('.productView-details .caskNo')
              ?.textContent || '';
          const archiveCodeMatch = rawArchiveCode.match(
            /([A-Za-z]*\d+)\.(\d+)/,
          );
          if (!archiveCodeMatch) return null;

          const code = archiveCodeMatch[0];

          return {
            name: getText('.productView-title'),
            code,
            price: getPrice(),
            description:
              getText('.productView-description') ||
              getText('.productView-info-value'),
            abv: getInfoValue('ABV'),
            age: getInfoValue('Age'),
            caskType: getInfoValue('CASK TYPE'),
            region: getInfoValue('REGION'),
            bottleSize: getInfoValue('BOTTLE SIZE') || '700ml',
            distillery: '',
            url: window.location.href,
          };
        });

        if (details === null) {
          this.logger.log(
            `Skipping archive "${whisky.title}" — no valid SMWS code found (not a regular bottling)`,
          );
        } else if (details.name) {
          detailedWhiskies.push(details as ScrapedArchiveWhiskyData);
        }
      } catch (error) {
        this.logger.error(
          `Error scraping archive ${whisky.title}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Archive detail scraping complete — ${detailedWhiskies.length}/${whiskies.length} succeeded`,
    );
    return detailedWhiskies;
  }

  private async getExistingArchiveWhiskiesFromDB(): Promise<
    ScrapedWhiskyListItem[]
  > {
    try {
      const rows = await this.archiveRepo.find({
        select: { name: true, url: true },
      });
      return rows.map((r) => ({ title: r.name, href: r.url ?? '' }));
    } catch (error) {
      this.logger.error('Error fetching existing archive whiskies:', error);
      return [];
    }
  }

  async saveArchiveWhiskiesToDatabase(
    whiskies: ScrapedArchiveWhiskyData[],
    isNew: boolean = false,
  ): Promise<number> {
    this.logger.log(
      `Saving ${whiskies.length} archive whiskies to database...`,
    );
    let savedCount = 0;

    for (const whisky of whiskies) {
      try {
        await this.archiveRepo.upsert(
          {
            name: whisky.name,
            code: whisky.code,
            price: whisky.price || null,
            description: whisky.description || null,
            abv: whisky.abv || null,
            age: whisky.age || null,
            caskType: whisky.caskType || null,
            distillery: whisky.distillery || null,
            region: whisky.region || null,
            bottleSize: whisky.bottleSize || null,
            url: whisky.url || null,
            isNew,
          },
          { conflictPaths: ['code'], skipUpdateIfNoValuesChanged: false },
        );
        savedCount++;
      } catch (error) {
        this.logger.error(
          `Error saving archive whisky ${whisky.name} (${whisky.code}): ${error.message}`,
        );
      }
    }

    this.logger.log(`Saved ${savedCount}/${whiskies.length} archive whiskies`);
    return savedCount;
  }

  async runArchiveScraper(): Promise<void> {
    if (this.isArchiveScraperRunning) {
      this.logger.warn(
        'Archive scraper run requested while a previous run is still in progress — skipping.',
      );
      return;
    }
    this.isArchiveScraperRunning = true;
    this.logger.log('=== STARTING SMWS ARCHIVE SCRAPER ===');

    const browser = await this.initBrowser();
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
    });
    const page = await context.newPage();

    try {
      this.logger.log('Step 1: Navigating to SMWS Archive...');
      await page.goto('https://smws.eu/archive', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await this.handleModals(page);

      this.logger.log('Step 2: Collecting archive whisky list...');
      const { items: allWhiskies, complete } =
        await this.collectAllArchiveWhiskyBasicInfo(page);
      if (!complete) {
        this.logger.warn(
          'Archive whisky list collection did not complete cleanly (a page kept failing) — proceeding with the partial list for new-item detection.',
        );
      }

      this.logger.log(
        'Step 3: Fetching existing archive whiskies from database...',
      );
      const existingWhiskies = await this.getExistingArchiveWhiskiesFromDB();
      this.logger.log(
        `Found ${existingWhiskies.length} existing archive whiskies`,
      );

      this.logger.log('Step 4: Comparing with database...');
      const newWhiskies = this.findNewWhiskies(allWhiskies, existingWhiskies);
      this.logger.log(`New archive whiskies: ${newWhiskies.length}`);

      let savedCount = 0;
      if (newWhiskies.length > 0) {
        this.logger.log(
          `Step 5: Scraping details for ${newWhiskies.length} new archive whiskies...`,
        );
        const detailedWhiskies = await this.scrapeArchiveWhiskyDetails(
          page,
          newWhiskies,
        );

        this.logger.log('Step 6: Saving new archive whiskies to database...');
        savedCount = await this.saveArchiveWhiskiesToDatabase(
          detailedWhiskies,
          true,
        );
      } else {
        this.logger.log('Step 5: No new archive whiskies to scrape');
      }

      this.logger.log(
        `=== ARCHIVE SCRAPER COMPLETED — new: ${newWhiskies.length}, saved: ${savedCount} ===`,
      );
    } catch (error) {
      this.logger.error(`Archive scraper error: ${error.message}`);
    } finally {
      await page.close();
      await context.close();
      await this.closeBrowser();
      this.isArchiveScraperRunning = false;
    }
  }
}
