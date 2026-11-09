import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasteepAuthModule } from '../auth/tasteep-auth.module';
import { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import { TasteepSmwsScrapeRun } from '../entities/tasteep-smws-scrape-run.entity';
import { RegionsModule } from '../regions/regions.module';
import { SmwsBottleSyncService } from './smws-bottle-sync.service';
import { SmwsBottlesController } from './smws-bottles.controller';
import { SmwsBottlesService } from './smws-bottles.service';
import { SmwsScrapeScheduler } from './smws-scrape.scheduler';
import { SmwsSiteScraper } from './smws-site.scraper';

/**
 * SMWS bottles scraped from smws.eu, linked to the distillery code list and
 * the curated regions. Bottles that leave the shop stay as our archive.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TasteepSmwsBottle,
      TasteepSmwsScrapeRun,
      TasteepSmwsCode,
    ]),
    TasteepAuthModule,
    RegionsModule,
  ],
  providers: [
    SmwsSiteScraper,
    SmwsBottleSyncService,
    SmwsBottlesService,
    SmwsScrapeScheduler,
  ],
  controllers: [SmwsBottlesController],
  exports: [SmwsBottlesService, SmwsBottleSyncService],
})
export class SmwsBottlesModule {}
