import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import { TasteepAuthModule } from '../auth/tasteep-auth.module';
import { RegionsModule } from '../regions/regions.module';
import { SmwsCodesService } from './smws-codes.service';
import { SmwsCodesController } from './smws-codes.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TasteepSmwsCode]),
    TasteepAuthModule,
    RegionsModule,
  ],
  providers: [SmwsCodesService],
  controllers: [SmwsCodesController],
  exports: [SmwsCodesService],
})
export class SmwsCodesModule {}
