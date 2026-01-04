import { Controller, Logger, Get } from "@nestjs/common";
import { ScraperService } from "./scraper.service";
import { Cron, CronExpression } from "@nestjs/schedule";

@Controller('scraper')
export class ScraperController {
  private readonly logger = new Logger(ScraperController.name);

  constructor(private readonly scraperService: ScraperService) {}

  @Get('run')
  async runScraper() {
    this.logger.log('Manual scraper run initiated.');
    const result = await this.scraperService.runScraper();
    return result;
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.log('Scheduled scraper run initiated.');
    await this.scraperService.runScraper();
  }
}