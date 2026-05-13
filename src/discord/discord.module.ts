import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserAlert } from '../entities/user-alert.entity';
import { DiscordService } from './discord.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserAlert])],
  providers: [DiscordService],
  exports: [DiscordService],
})
export class DiscordModule {}
