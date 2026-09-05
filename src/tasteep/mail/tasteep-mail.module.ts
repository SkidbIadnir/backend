import { Module } from '@nestjs/common';
import { TasteepMailService } from './tasteep-mail.service';

@Module({
  providers: [TasteepMailService],
  exports: [TasteepMailService],
})
export class TasteepMailModule {}
