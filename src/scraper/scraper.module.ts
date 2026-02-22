import { Module } from "@nestjs/common";
import { ScraperService } from "./scraper.service";
import { ScraperController } from "./scraper.controller";
import { PostgresModule } from "../postgres/postgres.module";
import { DiscordModule } from "../discord/discord.module";

@Module({
  imports: [PostgresModule, DiscordModule],
  controllers: [ScraperController],
  providers: [ScraperService],
  exports: [ScraperService],
})
export class ScraperModule {}