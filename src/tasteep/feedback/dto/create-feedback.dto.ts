import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { FEEDBACK_TYPES } from '../../entities/tasteep-feedback.entity';
import type { FeedbackType } from '../../entities/tasteep-feedback.entity';

export const FEEDBACK_MESSAGE_MAX_LENGTH = 4000;

export class CreateFeedbackDto {
  @IsIn(FEEDBACK_TYPES)
  type: FeedbackType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(FEEDBACK_MESSAGE_MAX_LENGTH)
  message: string;

  /** App build that sent it, e.g. `1.4.0+42`. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  app_version?: string;

  /** e.g. `ios`, `android`. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  platform?: string;
}
