import { IsIn } from 'class-validator';
import { FEEDBACK_STATUSES } from '../../tasteep/entities/tasteep-feedback.entity';
import type { FeedbackStatus } from '../../tasteep/entities/tasteep-feedback.entity';

export class UpdateFeedbackDto {
  @IsIn(FEEDBACK_STATUSES)
  status: FeedbackStatus;
}
