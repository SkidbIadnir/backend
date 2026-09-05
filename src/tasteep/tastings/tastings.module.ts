import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { TasteepAuthModule } from '../auth/tasteep-auth.module';
import { TastingsService } from './tastings.service';
import {
  TastingAggregatesController,
  TastingsController,
} from './tastings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TasteepTasting]), TasteepAuthModule],
  providers: [TastingsService],
  controllers: [TastingsController, TastingAggregatesController],
})
export class TastingsModule {}
