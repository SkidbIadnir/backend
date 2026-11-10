import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasteepAuthModule } from '../auth/tasteep-auth.module';
import { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import { TasteepSmwsPage } from '../entities/tasteep-smws-page.entity';
import { TasteepSmwsScrapeRun } from '../entities/tasteep-smws-scrape-run.entity';
import { RegionsModule } from '../regions/regions.module';
import { SmwsBottleSyncService } from './smws-bottle-sync.service';
import { SmwsBottlesController } from './smws-bottles.controller';
import { SmwsBottlesService } from './smws-bottles.service';
import { SmwsScrapeScheduler } from './smws-scrape.scheduler';
import { SmwsHttpClient } from './smws-http.client';

/**
 * SMWS bottles read from smws.eu (sitemap + product pages over plain HTTP),
 * linked to the distillery code list and the curated regions. Bottles that
 * sell out stay as our archive.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TasteepSmwsBottle,
      TasteepSmwsPage,
      TasteepSmwsScrapeRun,
      TasteepSmwsCode,
    ]),
    TasteepAuthModule,
    RegionsModule,
  ],
  providers: [
    SmwsHttpClient,
    SmwsBottleSyncService,
    SmwsBottlesService,
    SmwsScrapeScheduler,
  ],
  controllers: [SmwsBottlesController],
  exports: [SmwsBottlesService, SmwsBottleSyncService],
})
export class SmwsBottlesModule {}
