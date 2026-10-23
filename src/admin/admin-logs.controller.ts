import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminProtected, AdminQuery } from './admin-protected.decorator';
import { LogsQueryDto } from './dto/admin-queries.dto';
import { LogPage } from './dto/admin-responses.dto';
import { ADMIN_LOG_BUFFER, LogBuffer } from './logging/log-buffer';

@ApiTags('admin')
@Controller('admin')
@AdminProtected()
export class AdminLogsController {
  constructor(@Inject(ADMIN_LOG_BUFFER) private readonly buffer: LogBuffer) {}

  /** Most recent first. Only covers this process since it started. */
  @Get('logs')
  logs(@AdminQuery() query: LogsQueryDto): LogPage {
    const items = this.buffer.query({
      level: query.level,
      context: query.context,
      since: query.since ? new Date(query.since) : undefined,
      limit: Math.min(Math.max(query.limit ?? 200, 1), 1000),
    });
    return { items, total: items.length };
  }
}
