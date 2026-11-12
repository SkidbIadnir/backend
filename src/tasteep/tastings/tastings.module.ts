import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import { TasteepRegion } from '../entities/tasteep-region.entity';
import { SmwsMeService } from './smws-me.service';
import { TasteepAuthModule } from '../auth/tasteep-auth.module';
import { RegionsModule } from '../regions/regions.module';
import { SmwsBottlesModule } from '../smws-bottles/smws-bottles.module';
import { PhotosModule } from '../photos/photos.module';
import { TastingsService } from './tastings.service';
import {
  TastingAggregatesController,
  TastingsController,
} from './tastings.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TasteepTasting, TasteepSmwsCode, TasteepRegion]),
    TasteepAuthModule,
    RegionsModule,
    SmwsBottlesModule,
    PhotosModule,
  ],
  providers: [TastingsService, SmwsMeService],
  controllers: [TastingsController, TastingAggregatesController],
})
export class TastingsModule {}
