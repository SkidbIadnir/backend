import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuditService } from './admin-audit.service';
import type { AdminAuthRequest } from './admin-auth.guard';
import { AdminProtected } from './admin-protected.decorator';
import { AdminSmwsService } from './admin-smws.service';
import { ScraperStartedJson, SmwsStatusJson } from './dto/admin-responses.dto';

@ApiTags('admin')
@Controller('admin/smws')
@AdminProtected()
export class AdminSmwsController {
  constructor(
    private readonly smws: AdminSmwsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('status')
  status(): Promise<SmwsStatusJson> {
    return this.smws.status();
  }

  @Post('scraper/run')
  @HttpCode(HttpStatus.ACCEPTED)
  run(@Req() req: AdminAuthRequest): ScraperStartedJson {
    this.smws.start();
    this.audit.record(req.admin.email, 'run-scraper', 'smws');
    return { started: true };
  }
}
