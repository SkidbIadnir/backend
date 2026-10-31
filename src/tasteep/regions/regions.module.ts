import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasteepRegion } from '../entities/tasteep-region.entity';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { TasteepAuthModule } from '../auth/tasteep-auth.module';
import { RegionsService } from './regions.service';
import { RegionsController } from './regions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TasteepRegion, TasteepTasting, TasteepSmwsCode]),
    TasteepAuthModule,
  ],
  providers: [RegionsService],
  controllers: [RegionsController],
  exports: [RegionsService],
})
export class RegionsModule {}
