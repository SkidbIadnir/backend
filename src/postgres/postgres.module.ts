import { Module } from '@nestjs/common';
import { PostgresController } from './postgres.controller';
import { PostgresService } from './postgres.service';

@Module({
  controllers: [PostgresController],
  providers: [PostgresService],
  exports: [PostgresService],
})
export class PostgresModule {}
