import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmwsDistillery } from '../entities/smws-distillery.entity';
import { PostgresController } from './postgres.controller';
import { PostgresService } from './postgres.service';

@Module({
  imports: [TypeOrmModule.forFeature([SmwsDistillery])],
  controllers: [PostgresController],
  providers: [PostgresService],
  exports: [PostgresService],
})
export class PostgresModule {}
