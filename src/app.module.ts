import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { config } from 'dotenv';
import { AppService } from './app.service';
import { DiscordModule } from './discord/discord.module';
import { WatchtowerModule } from './watchtower/watchtower.module';
import { PostgresModule } from './postgres/postgres.module';
import { ScraperModule } from './scraper/scraper.module';
import { ScheduleModule } from '@nestjs/schedule';
import { MulterModule } from '@nestjs/platform-express';

config();

@Module({
  imports: [
    DiscordModule,
    WatchtowerModule,
    PostgresModule,
    ScheduleModule.forRoot(),
    MulterModule.register({
      dest: './uploads',
    }),
    ScraperModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
