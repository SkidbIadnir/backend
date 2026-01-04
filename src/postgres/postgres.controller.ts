import { Controller, Delete, Get } from '@nestjs/common';
import { PostgresService } from './postgres.service';

@Controller('postgres')
export class PostgresController {
  constructor(private readonly postgresService: PostgresService) {}

  @Get('tables')
  async ensureTables() {
    const result = await this.postgresService.ensureTablesExist();
    return result;
  }

  @Delete('tables/purge')
  async purgeTables() {
    const result = await this.postgresService.purgeTables();
    return result;
  }
}
