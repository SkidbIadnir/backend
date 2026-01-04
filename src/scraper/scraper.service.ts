import { Injectable, Logger } from "@nestjs/common";
import { PostgresService } from "../postgres/postgres.service";
import * as puppeteer from "puppeteer";

export interface ScrapedWhiskyData {
  name: string;
  fullCode: string;
  distilleryId?: number; // Optional, will be filled later
  caskNo?: string; // Optional, will be filled later
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

export interface ScrapedWhiskyListItem {
  title: string;
  href: string;
}

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(private readonly postgresService: PostgresService) {}
  
  // Add scraper methods here

  async runScraper(): Promise<ScrapedWhiskyData[]> {
    this.logger.log("Starting scraper...");

    const browser = await puppeteer.launch({ headless: false,
        defaultViewport: { width: 1280, height: 800 },
        args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    
    });
    try {
        const page = await browser.newPage();
        await this.navigateToListingsPage(page);
    } catch (error) {
        this.logger.error("Error during scraping process:", error);
    } finally {
        await browser.close();
        this.logger.log("Scraper finished.");
    }
    return [];
  }

  private async navigateToListingsPage(page: puppeteer.Page): Promise<void> {
    const listingsUrl = "https://www.smws.eu/all-whisky";
    this.logger.log(`Navigating to listings page: ${listingsUrl}`);
    await page.goto(listingsUrl, { waitUntil: "networkidle2" });
    
    // Handle age verification if present
    try {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const allCheckboxes = await page.evaluate(() => {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        return Array.from(checkboxes).map((cb) => ({
            id: cb.id,
            className: cb.className,
            name: (cb as HTMLInputElement).name,
            outerHTML: cb.outerHTML,
        }));});
        
        // Check if we found the age verification checkbox
      let ageCheckboxFound = false;
      const ageCheckbox = allCheckboxes.find(
        (cb) =>
          cb.id === 'ageCheckbox' ||
          cb.className.includes('js_acceptAge') ||
          cb.className.includes('ageCheckbox'),
      );

      if (ageCheckbox) {
        this.logger.log('Found age verification checkbox:', ageCheckbox);

        // Use the ID or class to select the checkbox
        const selector = ageCheckbox.id
          ? `#${ageCheckbox.id}`
          : `.${ageCheckbox.className.split(' ')[0]}`;

        try {
          // First check if checkbox exists and get its state
          const checkboxInfo = await page.evaluate((sel) => {
            const checkbox = document.querySelector(sel) as HTMLInputElement;
            if (!checkbox) return null;

            return {
              exists: true,
              checked: checkbox.checked,
              visible: checkbox.offsetParent !== null,
              disabled: checkbox.disabled,
              boundingRect: checkbox.getBoundingClientRect(),
            };
          }, selector);

          if (checkboxInfo?.exists) {
            this.logger.log('Checkbox info:', checkboxInfo);

            if (!checkboxInfo.checked) {
              // Try multiple methods to click the checkbox
              let clicked = false;

              // Method 1: Direct click
              try {
                await page.click(selector);
                clicked = true;
                this.logger.log(
                  'Age verification checkbox checked (direct click)',
                );
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
              } catch (e) {
                this.logger.log(
                  'Direct click failed, trying alternative methods',
                );
              }

              // Method 2: Force click with JavaScript if direct click failed
              if (!clicked) {
                try {
                  await page.evaluate((sel) => {
                    const checkbox = document.querySelector(
                      sel,
                    ) as HTMLInputElement;
                    if (checkbox) {
                      checkbox.checked = true;
                      // Trigger change event
                      checkbox.dispatchEvent(
                        new Event('change', { bubbles: true }),
                      );
                      checkbox.dispatchEvent(
                        new Event('click', { bubbles: true }),
                      );
                    }
                  }, selector);
                  clicked = true;
                  this.logger.log(
                    'Age verification checkbox checked (JavaScript)',
                  );
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                } catch (e) {
                  this.logger.log('JavaScript click failed');
                }
              }

              // Method 3: Try clicking the label instead
              if (!clicked) {
                try {
                  await page.click('label[for="ageCheckbox"]');
                  clicked = true;
                  this.logger.log(
                    'Age verification checkbox checked (via label)',
                  );
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                } catch (e) {
                  this.logger.log('Label click failed');
                }
              }

              if (clicked) {
                ageCheckboxFound = true;
              }
            } else {
              this.logger.log('Age verification checkbox was already checked');
              ageCheckboxFound = true;
            }
          }
        } catch (e) {
          this.logger.log(`Failed to interact with checkbox: ${e.message}`);
        }
      } else {
        this.logger.log(
          'No age verification checkbox found in discovered checkboxes',
        );
      }

      if (!ageCheckboxFound) {
        this.logger.log('No age verification checkbox found');
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars

    } catch (error) {
        this.logger.error("Error during age verification handling:", error);
    }

    // Handle cookie modal
    try {
      this.logger.log('Checking for cookie modal...');

      // Wait a bit for modals to appear
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Try multiple selectors for cookie acceptance
      const cookieSelectors = [
        // New SMWS cookie modal
        'button:contains("Accept All Cookies")',
        '.css-a0j149:contains("Accept All Cookies")',
        'button[class*="css-a0j149"]:contains("Accept")',
        // Previous selectors as fallback
        '[data-testid="cookie-accept"]',
        'button:contains("Accept")',
        'button:contains("Accept All")',
        'button:contains("Accept Cookies")',
        '#cookie-accept',
        '.cookie-accept',
      ];

      let cookieAccepted = false;
      for (const selector of cookieSelectors) {
        try {
          // First try CSS selector
          const button = await page.$(selector);
          if (button) {
            await button.click();
            this.logger.log(`Accepted cookies with selector: ${selector}`);
            cookieAccepted = true;
            break;
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          // Continue to next selector
        }
      }

      // If CSS selectors failed, try text-based search
      if (!cookieAccepted) {
        try {
          // Find button containing "Accept All Cookies" text
          const acceptButtons = await page.$$eval('button', (buttons) => {
            const acceptButton = buttons.find((btn) =>
              btn.textContent?.includes('Accept All Cookies'),
            );
            return acceptButton ? true : false;
          });

          if (acceptButtons) {
            await page.evaluate(() => {
              const buttons = document.querySelectorAll('button');
              const acceptButton = Array.from(buttons).find((btn) =>
                btn.textContent?.includes('Accept All Cookies'),
              );
              if (acceptButton) {
                (acceptButton as HTMLButtonElement).click();
              }
            });
            this.logger.log('Accepted cookies using button text search');
            cookieAccepted = true;
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          this.logger.log('Button text search cookie acceptance failed');
        }
      }

      // Alternative text searches if still not found
      if (!cookieAccepted) {
        const textSearches = ['Accept All', 'Accept', 'Accept Cookies'];

        for (const searchText of textSearches) {
          try {
            const found = await page.evaluate((text) => {
              const buttons = document.querySelectorAll('button');
              const button = Array.from(buttons).find((btn) =>
                btn.textContent?.includes(text),
              );
              if (button) {
                (button as HTMLButtonElement).click();
                return true;
              }
              return false;
            }, searchText);

            if (found) {
              this.logger.log(`Accepted cookies with text: ${searchText}`);
              cookieAccepted = true;
              break;
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            // Continue to next text search
          }
        }
      }

      if (!cookieAccepted) {
        this.logger.log('No cookie modal found or already accepted');
      }

      // Wait a bit after cookie acceptance
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      this.logger.log('Error handling cookie modal');
    }
  }
}
