import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TasteepJwtAuthGuard } from '../auth/tasteep-jwt-auth.guard';
import type { TasteepAuthRequest } from '../auth/tasteep-jwt-auth.guard';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { FeedbackService } from './feedback.service';
import type { FeedbackCreatedJson } from './feedback.service';

/** Bug reports, ideas and other messages from signed-in users. Fire-and-forget. */
@Controller('tasteep/feedback')
@UseGuards(TasteepJwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Req() req: TasteepAuthRequest,
    @Body() dto: CreateFeedbackDto,
  ): Promise<FeedbackCreatedJson> {
    return this.feedback.create(req.user.sub, dto);
  }
}
