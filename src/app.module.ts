import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { config } from 'dotenv';
import { AppService } from './app.service';
import { DiscordModule } from './discord/discord.module';

config();

@Module({
  imports: [DiscordModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
