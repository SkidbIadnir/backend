import { Injectable, Logger } from "@nestjs/common";
import { PostgresService } from "../postgres/postgres.service";
import { DiscordService } from "../discord/discord.service";
import { firefox, Browser, Page, BrowserContext } from "playwright";

export interface ScrapedWhiskyData {
  name: string;
  fullCode: string;
  distilleryId?: number | string; // Can be numeric (68) or alphanumeric (B1, G14)
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
  is_new?: boolean; // Flag to indicate if this is a newly discovered whisky
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
  is_new?: boolean;
}

export interface ScrapedWhiskyListItem {
  title: string;
  href: string;
}

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private browser: Browser | null = null;

  constructor(
    private readonly postgresService: PostgresService,
    private readonly discordService: DiscordService,
  ) {}

  /**
   * Initialize browser instance
   */
  private async initBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.logger.log("Launching browser...");
      this.browser = await firefox.launch({
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--ignore-certificate-errors',
        ],
      });
    }
    return this.browser;
  }

  /**
   * Close browser instance
   */
  private async closeBrowser(): Promise<void> {
    if (this.browser) {
      this.logger.log("Closing browser...");
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Handle age verification and cookie consent
   */
  private async handleModals(page: Page): Promise<void> {
    await this.delay(2000);

    // Handle age verification - try label click (most reliable)
    try {
      const label = page.locator('label[for="ageCheckbox"]');
      await label.click({ timeout: 3000 });
      this.logger.log('Age verification checked');
    } catch (error) {
      this.logger.log('No age verification found or already confirmed');
    }

    // Handle cookie consent
    try {
      const cookieButton = page.getByRole('button', { name: /accept all cookies|accept all|accept cookies|accept/i });
      await cookieButton.click({ timeout: 3000 });
      this.logger.log('Cookie consent accepted');
    } catch (error) {
      this.logger.log('No cookie modal found or already accepted');
    }

    await this.delay(1000);
  }

  /**
   * Collect all whisky basic info (title, href) from all pages
   */
  private async collectAllWhiskyBasicInfo(page: Page, startFromPage1: boolean = true): Promise<ScrapedWhiskyListItem[]> {
    this.logger.log('Collecting whisky list from all pages...');
    const allWhiskies: ScrapedWhiskyListItem[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      this.logger.log(`Scraping page ${currentPage}...`);
      
      try {
        // Only navigate if not already on page 1
        if (currentPage > 1 || !startFromPage1) {
          const pageUrl = `https://smws.eu/all-whisky?min-price=0&max-price=0&sort=featured&per-page=16&filter-page=${currentPage}`;
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        }
        
        await page.waitForSelector('#product-listing-container', { timeout: 15000 });
        await this.delay(2000);

        // Extract whisky cards from current page
        const pageWhiskies = await page.evaluate(() => {
          const container = document.querySelector('#product-listing-container');
          if (!container) return [];

          const cards = container.querySelectorAll('.card-title a');
          return Array.from(cards).map(card => ({
            title: card.textContent?.trim() || '',
            href: card.getAttribute('href') || '',
          }));
        });

        if (pageWhiskies.length === 0) {
          this.logger.log(`No products found on page ${currentPage}. Reached end.`);
          hasMorePages = false;
        } else {
          this.logger.log(`Found ${pageWhiskies.length} whiskies on page ${currentPage}`);
          allWhiskies.push(...pageWhiskies);
          currentPage++;
        }
      } catch (error) {
        this.logger.error(`Error on page ${currentPage}: ${error.message}`);
        hasMorePages = false;
      }
    }

    this.logger.log(`=== LISTING COMPLETE ===`);
    this.logger.log(`Total pages scraped: ${currentPage - 1}`);
    this.logger.log(`Total whiskies found: ${allWhiskies.length}`);
    return allWhiskies;
  }

  /**
   * Scrape detailed information from individual whisky pages
   */
  private async scrapeWhiskyDetails(page: Page, whiskies: ScrapedWhiskyListItem[]): Promise<ScrapedWhiskyData[]> {
    this.logger.log(`Starting detail scraping for ${whiskies.length} whiskies`);
    const detailedWhiskies: ScrapedWhiskyData[] = [];
    const baseUrl = 'https://smws.eu';

    for (let i = 0; i < whiskies.length; i++) {
      const whisky = whiskies[i];
      const url = whisky.href.startsWith('http') ? whisky.href : `${baseUrl}${whisky.href}`;

      this.logger.log(`[${i + 1}/${whiskies.length}] Scraping: ${whisky.title}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForSelector('.productView-details', { timeout: 15000 });
        await this.delay(500);

        // Extract whisky details
        const details = await page.evaluate(() => {
          const getText = (selector: string) => 
            document.querySelector(selector)?.textContent?.trim() || '';

          const getInfoValue = (infoName: string) => {
            const infoList = document.querySelectorAll('.productView-info li');
            for (const item of infoList) {
              const name = item.querySelector('.productView-info-name')?.textContent?.trim().toUpperCase();
              if (name === infoName.toUpperCase()) {
                return item.querySelector('.productView-info-value')?.textContent?.trim() || '';
              }
            }
            return '';
          };

          // Skip if no cask number (not a single bottle)
          if (!document.querySelector('.caskNo')) {
            return null;
          }

          let fullCode = getText('.caskNo');
          // Remove "CASK NO. " prefix if present
          if (fullCode.startsWith('CASK NO. ')) {
            fullCode = fullCode.replace('CASK NO. ', '');
          }
          
          let distilleryId: number | string | null = null;
          let caskNo: string | null = null;

          // Parse fullCode (e.g., "68.104" or "B1.123")
          if (fullCode) {
            const match = fullCode.match(/([A-Za-z]?\d+|[A-Za-z]+\d+)\.(\d+)/);
            if (match) {
              const code = match[1];
              caskNo = match[2];
              distilleryId = /^\d+$/.test(code) ? parseInt(code, 10) : code;
            }
          }

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
            distillery: '', // Will be filled later
            available: true,
            url: window.location.href,
            is_new: true,
          };
        });

        if (details && details.name) {
          detailedWhiskies.push(details as ScrapedWhiskyData);
        } else {
          this.logger.log(`Skipped ${whisky.title} - not a single bottle`);
        }
      } catch (error) {
        this.logger.error(`Error scraping ${whisky.title}: ${error.message}`);
      }
    }

    this.logger.log(`=== DETAIL SCRAPING COMPLETE ===`);
    this.logger.log(`Successfully scraped: ${detailedWhiskies.length}/${whiskies.length}`);
    return detailedWhiskies;
  }

  /**
   * Check new whiskies against user alerts and send notifications
   */
  private async checkAlertsAndNotify(newWhiskies: ScrapedWhiskyData[]): Promise<void> {
    if (newWhiskies.length === 0) {
      this.logger.log('No new whiskies to check for alerts');
      return;
    }

    this.logger.log(`Checking ${newWhiskies.length} new whiskies against user alerts...`);

    try {
      // Get all active alerts
      const alerts = await this.discordService.getAllAlerts();
      if (alerts.length === 0) {
        this.logger.log('No active alerts to check');
        return;
      }

      this.logger.log(`Found ${alerts.length} active alerts`);

      let notificationsSent = 0;

      for (const whisky of newWhiskies) {
        for (const alert of alerts) {
          let isMatch = false;

          switch (alert.alert_type) {
            case 'distillery':
              // Match distillery name OR code (case insensitive)
              const distilleryNameMatch = whisky.distillery?.toLowerCase() === alert.alert_value.toLowerCase();
              const distilleryCodeMatch = whisky.distilleryId?.toString().toLowerCase() === alert.alert_value.toLowerCase();
              isMatch = distilleryNameMatch || distilleryCodeMatch;
              
              // Debug logging
              if (alert.alert_value.toLowerCase() === '59') {
                this.logger.log(`Checking whisky "${whisky.name}": distilleryId=${whisky.distilleryId}, distillery="${whisky.distillery}", alert="${alert.alert_value}", nameMatch=${distilleryNameMatch}, codeMatch=${distilleryCodeMatch}`);
              }
              break;

            case 'region':
              // Match region name (case insensitive)
              isMatch = whisky.region?.toLowerCase() === alert.alert_value.toLowerCase();
              break;

            case 'age':
              // Match age greater than or equal to alert value
              const minAge = parseInt(alert.alert_value);
              const whiskyAge = parseInt(whisky.age);
              if (!isNaN(minAge) && !isNaN(whiskyAge)) {
                isMatch = whiskyAge >= minAge;
              }
              break;
          }

          if (isMatch) {
            this.logger.log(
              `Alert match found! User: ${alert.user_id}, Whisky: ${whisky.name}, Alert: ${alert.alert_type}=${alert.alert_value}`
            );

            await this.discordService.sendAlertNotification(
              alert.user_id,
              alert.guild_id,
              {
                name: whisky.name,
                distillery: whisky.distillery,
                region: whisky.region,
                age: whisky.age,
                price: whisky.price,
                abv: whisky.abv,
                url: whisky.url,
              },
              alert.alert_type,
              alert.alert_value
            );

            notificationsSent++;
          }
        }
      }

      this.logger.log(`Alert notifications sent: ${notificationsSent}`);
    } catch (error) {
      this.logger.error('Error checking alerts:', error);
    }
  }

  /**
   * Test alerts against existing whiskies in database (for testing purposes)
   */
  async testAlertsWithExistingData(): Promise<{ checked: number; matched: number }> {
    this.logger.log('=== TESTING ALERTS WITH EXISTING DATA ===');
    
    try {
      // Get all whiskies from database
      const query = `
        SELECT name, fullCode, distillery_code as "distilleryId", distillery, region, age, price, abv, url, available
        FROM smws_live 
        WHERE available = true
        ORDER BY created_at DESC
      `;
      const dbWhiskies = await this.postgresService.query(query);
      this.logger.log(`Found ${dbWhiskies.length} available whiskies in database`);

      // Get all active alerts
      const alerts = await this.discordService.getAllAlerts();
      if (alerts.length === 0) {
        this.logger.log('No active alerts to test');
        return { checked: 0, matched: 0 };
      }

      this.logger.log(`Testing against ${alerts.length} active alerts`);

      let matchCount = 0;

      for (const whisky of dbWhiskies) {
        for (const alert of alerts) {
          let isMatch = false;

          switch (alert.alert_type) {
            case 'distillery':
              const distilleryNameMatch = whisky.distillery?.toLowerCase() === alert.alert_value.toLowerCase();
              const distilleryCodeMatch = whisky.distilleryId?.toString().toLowerCase() === alert.alert_value.toLowerCase();
              isMatch = distilleryNameMatch || distilleryCodeMatch;
              
              this.logger.log(
                `Testing whisky "${whisky.name}": ` +
                `distilleryId="${whisky.distilleryId}", distillery="${whisky.distillery}", ` +
                `alert="${alert.alert_value}", nameMatch=${distilleryNameMatch}, codeMatch=${distilleryCodeMatch}, ` +
                `result=${isMatch}`
              );
              break;

            case 'region':
              isMatch = whisky.region?.toLowerCase() === alert.alert_value.toLowerCase();
              break;

            case 'age':
              const minAge = parseInt(alert.alert_value);
              const whiskyAge = parseInt(whisky.age);
              if (!isNaN(minAge) && !isNaN(whiskyAge)) {
                isMatch = whiskyAge >= minAge;
              }
              break;
          }

          if (isMatch) {
            matchCount++;
            this.logger.log(
              `✅ MATCH: Whisky "${whisky.name}" matches alert (${alert.alert_type}=${alert.alert_value}) for user ${alert.user_id}`
            );

            // Send notification for testing
            await this.discordService.sendAlertNotification(
              alert.user_id,
              alert.guild_id,
              {
                name: whisky.name,
                distillery: whisky.distillery,
                region: whisky.region,
                age: whisky.age,
                price: whisky.price,
                abv: whisky.abv,
                url: whisky.url,
              },
              alert.alert_type,
              alert.alert_value
            );
          }
        }
      }

      this.logger.log(`=== TEST COMPLETE: ${matchCount} matches found ===`);
      return { checked: dbWhiskies.length, matched: matchCount };
    } catch (error) {
      this.logger.error('Error testing alerts:', error);
      throw error;
    }
  }

  /**
   * Main scraper runner
   */
  async runScraper(): Promise<ScrapedWhiskyData[]> {
    this.logger.log("=== STARTING SMWS SCRAPER ===");
    
    const browser = await this.initBrowser();
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
    });
    const page = await context.newPage();

    try {
      // Step 1: Navigate and handle modals
      this.logger.log('Step 1: Navigating to SMWS...');
      await page.goto('https://smws.eu/all-whisky', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await this.handleModals(page);

      // Step 2: Collect all whisky basic info from all pages
      this.logger.log('Step 2: Collecting whisky list...');
      const allWhiskies = await this.collectAllWhiskyBasicInfo(page, true);

      // Step 3: Get existing whiskies from database
      this.logger.log('Step 3: Fetching existing whiskies from database...');
      const existingWhiskies = await this.getExistingWhiskiesFromDB();
      this.logger.log(`Found ${existingWhiskies.length} existing whiskies in database`);

      // Step 4: Compare and find differences
      this.logger.log('Step 4: Comparing with database...');
      const newWhiskies = this.findNewWhiskies(allWhiskies, existingWhiskies);
      const removedWhiskies = this.findRemovedWhiskies(allWhiskies, existingWhiskies);
      const existingAvailableWhiskies = allWhiskies.filter(scraped => 
        existingWhiskies.some(existing => existing.title === scraped.title)
      );

      this.logger.log(`New whiskies: ${newWhiskies.length}`);
      this.logger.log(`Removed whiskies: ${removedWhiskies.length}`);
      this.logger.log(`Existing available whiskies: ${existingAvailableWhiskies.length}`);

      // Step 5: Mark removed whiskies as unavailable
      if (removedWhiskies.length > 0) {
        this.logger.log('Step 5: Marking removed whiskies as unavailable...');
        await this.markWhiskiesAsUnavailable(removedWhiskies);
      }

      // Step 6: Mark existing whiskies as available
      if (existingAvailableWhiskies.length > 0) {
        this.logger.log('Step 6: Ensuring existing whiskies are available...');
        await this.markWhiskiesAsAvailable(existingAvailableWhiskies);
      }

      // Step 7: Scrape details only for NEW whiskies
      let savedCount = 0;
      let detailedWhiskies: ScrapedWhiskyData[] = [];
      if (newWhiskies.length > 0) {
        this.logger.log(`Step 7: Scraping details for ${newWhiskies.length} new whiskies...`);
        detailedWhiskies = await this.scrapeWhiskyDetails(page, newWhiskies);
        
        this.logger.log('Step 8: Saving new whiskies to database...');
        savedCount = await this.saveWhiskiesToDatabase(detailedWhiskies, true);
      } else {
        this.logger.log('Step 7: No new whiskies to scrape');
      }

      // Step 9: Check alerts and send notifications for new whiskies
      this.logger.log('Step 9: Checking alerts for new whiskies...');
      await this.checkAlertsAndNotify(detailedWhiskies);

      // Step 10: Update isNew flags based on 3-day rule
      this.logger.log('Step 10: Updating isNew flags...');
      await this.updateIsNewFlags();

      this.logger.log(`=== SCRAPER COMPLETED ===`);
      this.logger.log(`Total new whiskies found: ${newWhiskies.length}`);
      this.logger.log(`Total whiskies saved: ${savedCount}`);
      this.logger.log(`Whiskies marked unavailable: ${removedWhiskies.length}`);
      
      return [];
    } catch (error) {
      this.logger.error(`Scraper error: ${error.message}`);
      return [];
    } finally {
      await page.close();
      await context.close();
      await this.closeBrowser();
    }
  }

  /**
   * Get distillery name by code from database
   */
  private async getDistilleryNameByCode(distilleryId: string | number): Promise<string | null> {
    try {
      const query = `SELECT distillery_name FROM smws_distilleries WHERE smws_id = $1`;
      const result = await this.postgresService.query(query, [distilleryId.toString()]);
      return result?.[0]?.distillery_name || null;
    } catch (error) {
      this.logger.error(`Error fetching distillery name for code ${distilleryId}:`, error);
      return null;
    }
  }

  /**
   * Get existing whiskies from database
   */
  private async getExistingWhiskiesFromDB(): Promise<ScrapedWhiskyListItem[]> {
    try {
      const query = `SELECT name, url FROM smws_live`;
      const result = await this.postgresService.query(query);
      return result.map(row => ({
        title: row.name,
        href: row.url || '',
      }));
    } catch (error) {
      this.logger.error('Error fetching existing whiskies:', error);
      return [];
    }
  }

  /**
   * Find new whiskies (not in database)
   */
  private findNewWhiskies(
    scrapedWhiskies: ScrapedWhiskyListItem[],
    existingWhiskies: ScrapedWhiskyListItem[],
  ): ScrapedWhiskyListItem[] {
    const existingTitles = new Set(existingWhiskies.map(w => w.title));
    return scrapedWhiskies.filter(w => !existingTitles.has(w.title));
  }

  /**
   * Find removed whiskies (in database but not on website)
   */
  private findRemovedWhiskies(
    scrapedWhiskies: ScrapedWhiskyListItem[],
    existingWhiskies: ScrapedWhiskyListItem[],
  ): ScrapedWhiskyListItem[] {
    const scrapedTitles = new Set(scrapedWhiskies.map(w => w.title));
    return existingWhiskies.filter(w => !scrapedTitles.has(w.title));
  }

  /**
   * Mark whiskies as unavailable
   */
  private async markWhiskiesAsUnavailable(whiskies: ScrapedWhiskyListItem[]): Promise<void> {
    this.logger.log(`Marking ${whiskies.length} whiskies as unavailable`);
    
    for (const whisky of whiskies) {
      try {
        const query = `UPDATE smws_live SET available = false, updated_at = CURRENT_TIMESTAMP WHERE name = $1`;
        await this.postgresService.query(query, [whisky.title]);
      } catch (error) {
        this.logger.error(`Error marking whisky as unavailable: ${whisky.title}`, error);
      }
    }
  }

  /**
   * Mark existing whiskies as available
   */
  private async markWhiskiesAsAvailable(whiskies: ScrapedWhiskyListItem[]): Promise<void> {
    this.logger.log(`Ensuring ${whiskies.length} whiskies are marked as available`);
    
    for (const whisky of whiskies) {
      try {
        const query = `UPDATE smws_live SET available = true, updated_at = CURRENT_TIMESTAMP WHERE name = $1`;
        await this.postgresService.query(query, [whisky.title]);
      } catch (error) {
        this.logger.error(`Error marking whisky as available: ${whisky.title}`, error);
      }
    }
  }

  /**
   * Update isNew flag based on 3-day rule
   */
  private async updateIsNewFlags(): Promise<void> {
    this.logger.log('Updating isNew flags based on 3-day rule...');
    
    try {
      // Untick isNew for whiskies older than 3 days
      const query = `
        UPDATE smws_live 
        SET is_new = false, updated_at = CURRENT_TIMESTAMP
        WHERE is_new = true 
        AND new_since IS NOT NULL 
        AND new_since < NOW() - INTERVAL '3 days'
      `;
      
      await this.postgresService.query(query);
      this.logger.log('Updated isNew flags successfully');
    } catch (error) {
      this.logger.error('Error updating isNew flags:', error);
    }
  }

  /**
   * Save whiskies to database
   */
  async saveWhiskiesToDatabase(whiskies: ScrapedWhiskyData[], isNew: boolean = false): Promise<number> {
    this.logger.log(`Saving ${whiskies.length} whiskies to database...`);
    let savedCount = 0;

    for (const whisky of whiskies) {
      try {
        // Get distillery name if we have a distillery code
        if (whisky.distilleryId && !whisky.distillery) {
          whisky.distillery = await this.getDistilleryNameByCode(whisky.distilleryId) || '';
        }

        const query = `
          INSERT INTO smws_live 
            (name, fullCode, distillery_code, cask_no, price, abv, age, cask_type, profile, distillery, region, available, url, is_new, new_since)
          VALUES 
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (fullCode) 
          DO UPDATE SET 
            name = EXCLUDED.name,
            price = EXCLUDED.price,
            abv = EXCLUDED.abv,
            age = EXCLUDED.age,
            cask_type = EXCLUDED.cask_type,
            profile = EXCLUDED.profile,
            distillery = EXCLUDED.distillery,
            region = EXCLUDED.region,
            available = EXCLUDED.available,
            url = EXCLUDED.url,
            updated_at = CURRENT_TIMESTAMP
        `;

        await this.postgresService.query(query, [
          whisky.name,
          whisky.fullCode,
          whisky.distilleryId?.toString() || null,
          whisky.caskNo || null,
          whisky.price,
          whisky.abv,
          whisky.age,
          whisky.caskType,
          whisky.profile,
          whisky.distillery,
          whisky.region,
          whisky.available,
          whisky.url,
          isNew,
          isNew ? new Date() : null,
        ]);

        savedCount++;
      } catch (error) {
        this.logger.error(`Error saving whisky ${whisky.name} (${whisky.fullCode}): ${error.message}`);
      }
    }

    this.logger.log(`Successfully saved ${savedCount}/${whiskies.length} whiskies to database`);
    return savedCount;
  }

  /**
   * Utility: Wait for a specific time
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Utility: Take screenshot (useful for debugging)
   */
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
  // ARCHIVE SCRAPER METHODS
  // ============================================

  /**
   * Collect all archive whisky basic info from all pages
   */
  private async collectAllArchiveWhiskyBasicInfo(page: Page, startFromPage1: boolean = true): Promise<ScrapedWhiskyListItem[]> {
    this.logger.log('Collecting archive whisky list from all pages...');
    const allWhiskies: ScrapedWhiskyListItem[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      this.logger.log(`Scraping archive page ${currentPage}...`);
      
      try {
        if (currentPage > 1 || !startFromPage1) {
          const pageUrl = `https://smws.eu/archive?page=${currentPage}`;
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        }
        
        await page.waitForSelector('#product-listing-container', { timeout: 15000 });
        await this.delay(2000);

        const pageWhiskies = await page.evaluate(() => {
          const container = document.querySelector('#product-listing-container');
          if (!container) return [];

          const cards = container.querySelectorAll('.card-title a');
          return Array.from(cards).map(card => ({
            title: card.textContent?.trim() || '',
            href: card.getAttribute('href') || '',
          }));
        });

        if (pageWhiskies.length === 0) {
          this.logger.log(`No products found on archive page ${currentPage}. Reached end.`);
          hasMorePages = false;
        } else {
          this.logger.log(`Found ${pageWhiskies.length} archive whiskies on page ${currentPage}`);
          allWhiskies.push(...pageWhiskies);
          currentPage++;
        }
      } catch (error) {
        this.logger.error(`Error on archive page ${currentPage}: ${error.message}`);
        hasMorePages = false;
      }
    }

    this.logger.log(`=== ARCHIVE LISTING COMPLETE ===`);
    this.logger.log(`Total archive pages scraped: ${currentPage - 1}`);
    this.logger.log(`Total archive whiskies found: ${allWhiskies.length}`);
    return allWhiskies;
  }

  /**
   * Scrape detailed information from individual archive whisky pages
   */
  private async scrapeArchiveWhiskyDetails(page: Page, whiskies: ScrapedWhiskyListItem[]): Promise<ScrapedArchiveWhiskyData[]> {
    this.logger.log(`Starting archive detail scraping for ${whiskies.length} whiskies`);
    const detailedWhiskies: ScrapedArchiveWhiskyData[] = [];
    const baseUrl = 'https://smws.eu';

    for (let i = 0; i < whiskies.length; i++) {
      const whisky = whiskies[i];
      const url = whisky.href.startsWith('http') ? whisky.href : `${baseUrl}${whisky.href}`;

      this.logger.log(`[${i + 1}/${whiskies.length}] Scraping archive: ${whisky.title}`);

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
              const name = item.querySelector('.productView-info-name')?.textContent?.trim().toUpperCase();
              if (name === infoName.toUpperCase()) {
                return item.querySelector('.productView-info-value')?.textContent?.trim() || '';
              }
            }
            return '';
          };

          // Extract price from BCData script tag
          const getPrice = () => {
            const scripts = document.querySelectorAll('script[type="text/javascript"]');
            for (const script of scripts) {
              const content = script.textContent || '';
              if (content.includes('var BCData')) {
                try {
                  // Extract the BCData JSON
                  const match = content.match(/var BCData = ({.*?});/s);
                  if (match) {
                    const bcData = JSON.parse(match[1]);
                    const priceData = bcData?.product_attributes?.price?.with_tax;
                    if (priceData?.formatted) {
                      return priceData.formatted;
                    }
                  }
                } catch (e) {
                  console.error('Error parsing BCData:', e);
                }
              }
            }
            return '';
          };

          let code = getText('.caskNo') || getText('.productView-title');
          // Remove "CASK NO. " prefix if present
          if (code.startsWith('CASK NO. ')) {
            code = code.replace('CASK NO. ', '');
          }

          return {
            name: getText('.productView-title'),
            code: code,
            price: getPrice(),
            description: getText('.productView-description') || getText('.productView-info-value'),
            abv: getInfoValue('ABV'),
            age: getInfoValue('Age'),
            caskType: getInfoValue('CASK TYPE'),
            region: getInfoValue('REGION'),
            bottleSize: getInfoValue('BOTTLE SIZE') || '700ml',
            distillery: '',
            url: window.location.href,
            is_new: true,
          };
        });

        if (details && details.name) {
          detailedWhiskies.push(details as ScrapedArchiveWhiskyData);
        }
      } catch (error) {
        this.logger.error(`Error scraping archive ${whisky.title}: ${error.message}`);
      }
    }

    this.logger.log(`=== ARCHIVE DETAIL SCRAPING COMPLETE ===`);
    this.logger.log(`Successfully scraped: ${detailedWhiskies.length}/${whiskies.length}`);
    return detailedWhiskies;
  }

  /**
   * Get existing archive whiskies from database
   */
  private async getExistingArchiveWhiskiesFromDB(): Promise<ScrapedWhiskyListItem[]> {
    try {
      const query = `SELECT name, url FROM smws_archive`;
      const result = await this.postgresService.query(query);
      return result.map(row => ({
        title: row.name,
        href: row.url || '',
      }));
    } catch (error) {
      this.logger.error('Error fetching existing archive whiskies:', error);
      return [];
    }
  }

  /**
   * Save archive whiskies to database
   */
  async saveArchiveWhiskiesToDatabase(whiskies: ScrapedArchiveWhiskyData[], isNew: boolean = false): Promise<number> {
    this.logger.log(`Saving ${whiskies.length} archive whiskies to database...`);
    let savedCount = 0;

    for (const whisky of whiskies) {
      try {
        const query = `
          INSERT INTO smws_archive 
            (name, code, price, description, abv, age, cask_type, distillery, region, bottle_size, url, is_new)
          VALUES 
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (code) 
          DO UPDATE SET 
            name = EXCLUDED.name,
            price = EXCLUDED.price,
            description = EXCLUDED.description,
            abv = EXCLUDED.abv,
            age = EXCLUDED.age,
            cask_type = EXCLUDED.cask_type,
            distillery = EXCLUDED.distillery,
            region = EXCLUDED.region,
            bottle_size = EXCLUDED.bottle_size,
            url = EXCLUDED.url,
            updated_at = CURRENT_TIMESTAMP
        `;

        await this.postgresService.query(query, [
          whisky.name,
          whisky.code,
          whisky.price,
          whisky.description,
          whisky.abv,
          whisky.age,
          whisky.caskType,
          whisky.distillery,
          whisky.region,
          whisky.bottleSize,
          whisky.url,
          isNew,
        ]);

        savedCount++;
      } catch (error) {
        this.logger.error(`Error saving archive whisky ${whisky.name} (${whisky.code}): ${error.message}`);
      }
    }

    this.logger.log(`Successfully saved ${savedCount}/${whiskies.length} archive whiskies to database`);
    return savedCount;
  }

  /**
   * Main archive scraper runner
   */
  async runArchiveScraper(): Promise<ScrapedArchiveWhiskyData[]> {
    this.logger.log("=== STARTING SMWS ARCHIVE SCRAPER ===");
    
    const browser = await this.initBrowser();
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
    });
    const page = await context.newPage();

    try {
      // Step 1: Navigate and handle modals
      this.logger.log('Step 1: Navigating to SMWS Archive...');
      await page.goto('https://smws.eu/archive', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await this.handleModals(page);

      // Step 2: Collect all archive whisky basic info from all pages
      this.logger.log('Step 2: Collecting archive whisky list...');
      const allWhiskies = await this.collectAllArchiveWhiskyBasicInfo(page, true);

      // Step 3: Get existing archive whiskies from database
      this.logger.log('Step 3: Fetching existing archive whiskies from database...');
      const existingWhiskies = await this.getExistingArchiveWhiskiesFromDB();
      this.logger.log(`Found ${existingWhiskies.length} existing archive whiskies in database`);

      // Step 4: Compare and find differences
      this.logger.log('Step 4: Comparing with database...');
      const newWhiskies = this.findNewWhiskies(allWhiskies, existingWhiskies);
      
      this.logger.log(`New archive whiskies: ${newWhiskies.length}`);

      // Step 5: Scrape details only for NEW archive whiskies
      let savedCount = 0;
      if (newWhiskies.length > 0) {
        this.logger.log(`Step 5: Scraping details for ${newWhiskies.length} new archive whiskies...`);
        const detailedWhiskies = await this.scrapeArchiveWhiskyDetails(page, newWhiskies);
        
        this.logger.log('Step 6: Saving new archive whiskies to database...');
        savedCount = await this.saveArchiveWhiskiesToDatabase(detailedWhiskies, true);
      } else {
        this.logger.log('Step 5: No new archive whiskies to scrape');
      }

      this.logger.log(`=== ARCHIVE SCRAPER COMPLETED ===`);
      this.logger.log(`Total new archive whiskies found: ${newWhiskies.length}`);
      this.logger.log(`Total archive whiskies saved: ${savedCount}`);
      
      return [];
    } catch (error) {
      this.logger.error(`Archive scraper error: ${error.message}`);
      return [];
    } finally {
      await page.close();
      await context.close();
      await this.closeBrowser();
    }
  }
}
