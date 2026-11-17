import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuditService } from './admin-audit.service';
import type { AdminAuthRequest } from './admin-auth.guard';
import { AdminFeedbackService } from './admin-feedback.service';
import { AdminProtected, AdminQuery } from './admin-protected.decorator';
import { FeedbackQueryDto } from './dto/admin-queries.dto';
import {
  AdminFeedbackJson,
  AdminFeedbackPage,
} from './dto/admin-responses.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';

/** What users sent through `POST /tasteep/feedback`. `status` is for triage only; users never see it. */
@ApiTags('admin')
@Controller('admin/feedback')
@AdminProtected()
export class AdminFeedbackController {
  constructor(
    private readonly feedback: AdminFeedbackService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list(@AdminQuery() query: FeedbackQueryDto): Promise<AdminFeedbackPage> {
    return this.feedback.list(query);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeedbackDto,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminFeedbackJson> {
    const row = await this.feedback.setStatus(id, dto.status);
    this.audit.record(req.admin.email, `feedback-${dto.status}`, id);
    return row;
  }
}
