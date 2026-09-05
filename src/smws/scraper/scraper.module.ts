import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmwsLive } from '../entities/smws-live.entity';
import { SmwsArchive } from '../entities/smws-archive.entity';
import { SmwsDistillery } from '../entities/smws-distillery.entity';
import { ScraperService } from './scraper.service';
import { ScraperController } from './scraper.controller';
import { ScraperApiKeyGuard } from './scraper-api-key.guard';

@Module({
  imports: [TypeOrmModule.forFeature([SmwsLive, SmwsArchive, SmwsDistillery])],
  controllers: [ScraperController],
  providers: [ScraperService, ScraperApiKeyGuard],
  exports: [ScraperService],
})
export class ScraperModule {}
