import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { TasteepFeedback } from '../entities/tasteep-feedback.entity';
import { tasteepConfig } from '../tasteep-config';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

const HOUR_MS = 60 * 60 * 1000;

export interface FeedbackCreatedJson {
  id: string;
  created_at: string;
}

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(TasteepFeedback)
    private readonly repo: Repository<TasteepFeedback>,
  ) {}

  async create(
    userId: string,
    dto: CreateFeedbackDto,
  ): Promise<FeedbackCreatedJson> {
    const message = dto.message.trim();
    if (!message) throw new BadRequestException('message must not be blank');

    // Per user rather than per IP: the route is authenticated, and a shared
    // network shouldn't lock out everyone behind it.
    const recent = await this.repo.count({
      where: {
        userId,
        createdAt: MoreThan(new Date(Date.now() - HOUR_MS)),
      },
    });
    if (recent >= tasteepConfig.feedbackMaxPerHour) {
      throw new HttpException(
        'Too much feedback sent recently, try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const saved = await this.repo.save(
      this.repo.create({
        userId,
        type: dto.type,
        message,
        appVersion: dto.app_version?.trim() || null,
        platform: dto.platform?.trim() || null,
      }),
    );
    return { id: saved.id, created_at: saved.createdAt.toISOString() };
  }
}
