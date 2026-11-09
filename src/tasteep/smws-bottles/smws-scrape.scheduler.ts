import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { tasteepConfig } from '../tasteep-config';
import { SmwsBottleSyncService } from './smws-bottle-sync.service';

/** Nightly scrape. Turned off with `TASTEEP_SMWS_SCRAPER_ENABLED=false`. */
@Injectable()
export class SmwsScrapeScheduler {
  private readonly logger = new Logger(SmwsScrapeScheduler.name);

  constructor(private readonly sync: SmwsBottleSyncService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'tasteep-smws-scrape' })
  async nightly(): Promise<void> {
    if (!tasteepConfig.smwsScraperEnabled) {
      this.logger.log('Nightly SMWS scrape disabled by configuration.');
      return;
    }
    await this.sync.run('cron');
  }
}
