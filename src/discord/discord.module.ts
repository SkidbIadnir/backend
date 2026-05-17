import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { DiscordService } from './discord.service';

@Module({
  imports: [AlertsModule],
  providers: [DiscordService],
  exports: [DiscordService],
})
export class DiscordModule {}
