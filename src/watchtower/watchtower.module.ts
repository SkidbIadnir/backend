import { Module } from '@nestjs/common';
import { PostgresModule } from '../postgres/postgres.module';
import { WatchtowerController } from './watchtower.controller';
import { WatchtowerService } from './watchtower.service';

@Module({
  imports: [PostgresModule],
  controllers: [WatchtowerController],
  providers: [WatchtowerService],
})
export class WatchtowerModule {}
