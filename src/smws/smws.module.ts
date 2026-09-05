import { Module } from '@nestjs/common';
import { ScraperModule } from './scraper/scraper.module';
import { WatchtowerModule } from './watchtower/watchtower.module';
import { PostgresModule } from './postgres/postgres.module';

/**
 * SMWS Watchtower — scrapes smws.eu on a schedule and exposes the inventory
 * read-only for a website. No users, no auth, no notifications.
 *
 * Everything under `src/smws/` is self-contained (tables `smws_*`, routes
 * `/smws/*`). Nothing here is imported by the Tasteep project and vice versa.
 */
@Module({
  imports: [ScraperModule, WatchtowerModule, PostgresModule],
})
export class SmwsModule {}
