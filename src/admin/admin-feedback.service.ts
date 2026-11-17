import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FeedbackStatus,
  TasteepFeedback,
} from '../tasteep/entities/tasteep-feedback.entity';
import { FeedbackQueryDto } from './dto/admin-queries.dto';
import {
  AdminFeedbackJson,
  AdminFeedbackPage,
} from './dto/admin-responses.dto';

const toJson = (f: TasteepFeedback): AdminFeedbackJson => ({
  id: f.id,
  user_id: f.userId,
  user_email: f.user?.email ?? null,
  user_display_name: f.user?.displayName ?? null,
  type: f.type,
  message: f.message,
  app_version: f.appVersion,
  platform: f.platform,
  status: f.status,
  created_at: f.createdAt.toISOString(),
  updated_at: f.updatedAt.toISOString(),
});

@Injectable()
export class AdminFeedbackService {
  constructor(
    @InjectRepository(TasteepFeedback)
    private readonly repo: Repository<TasteepFeedback>,
  ) {}

  /** Newest first. */
  async list(query: FeedbackQueryDto): Promise<AdminFeedbackPage> {
    const qb = this.repo
      .createQueryBuilder('f')
      .leftJoinAndSelect('f.user', 'u')
      .orderBy('f.createdAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);
    if (query.status) qb.andWhere('f.status = :s', { s: query.status });
    if (query.type) qb.andWhere('f.type = :t', { t: query.type });
    if (query.user_id) qb.andWhere('f.userId = :uid', { uid: query.user_id });
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(toJson), total };
  }

  async setStatus(
    id: string,
    status: FeedbackStatus,
  ): Promise<AdminFeedbackJson> {
    const row = await this.repo.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!row) throw new NotFoundException('Feedback not found');
    row.status = status;
    return toJson(await this.repo.save(row));
  }
}
