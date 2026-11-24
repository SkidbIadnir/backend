import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasteepFlavour } from '../entities/tasteep-flavour.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { TasteepAuthModule } from '../auth/tasteep-auth.module';
import { FlavoursService } from './flavours.service';
import { FlavoursController } from './flavours.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TasteepFlavour, TasteepTasting]),
    TasteepAuthModule,
  ],
  providers: [FlavoursService],
  controllers: [FlavoursController],
  exports: [FlavoursService],
})
export class FlavoursModule {}
