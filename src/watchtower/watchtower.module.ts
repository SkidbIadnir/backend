import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmwsLive } from '../entities/smws-live.entity';
import { WatchtowerController } from './watchtower.controller';
import { WatchtowerService } from './watchtower.service';

@Module({
  imports: [TypeOrmModule.forFeature([SmwsLive])],
  controllers: [WatchtowerController],
  providers: [WatchtowerService],
})
export class WatchtowerModule {}
