import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { PostgresModule } from '../postgres/postgres.module';

@Module({
  imports: [PostgresModule],
  providers: [DiscordService],
  exports: [DiscordService],
})
export class DiscordModule {}