import { Controller, Logger, Get, UseGuards } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScraperApiKeyGuard } from './scraper-api-key.guard';

@Controller('smws/scraper')
export class ScraperController {
  private readonly logger = new Logger(ScraperController.name);

  constructor(private readonly scraperService: ScraperService) {}

  @UseGuards(ScraperApiKeyGuard)
  @Get('run-live')
  async runLiveScraper() {
    this.logger.log('Manual live scraper run initiated.');
    await this.scraperService.runScraper();
    return { message: 'Live scraper completed' };
  }

  @UseGuards(ScraperApiKeyGuard)
  @Get('run-archive')
  async runArchiveScraper() {
    this.logger.log('Manual archive scraper run initiated.');
    await this.scraperService.runArchiveScraper();
    return { message: 'Archive scraper completed' };
  }

  /**
   * Scheduled job - Live scraper runs every day at midnight
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async scheduledLiveScraperJob() {
    this.logger.log('=== SCHEDULED LIVE SCRAPER STARTING ===');
    try {
      await this.scraperService.runScraper();
      this.logger.log('=== SCHEDULED LIVE SCRAPER COMPLETED ===');
    } catch (error) {
      this.logger.error('Scheduled live scraper failed:', error);
    }
  }

  /**
   * Scheduled job - Archive scraper runs every 2 days at 1 AM
   */
  @Cron('0 1 */2 * *')
  async scheduledArchiveScraperJob() {
    this.logger.log('=== SCHEDULED ARCHIVE SCRAPER STARTING ===');
    try {
      await this.scraperService.runArchiveScraper();
      this.logger.log('=== SCHEDULED ARCHIVE SCRAPER COMPLETED ===');
    } catch (error) {
      this.logger.error('Scheduled archive scraper failed:', error);
    }
  }
}
