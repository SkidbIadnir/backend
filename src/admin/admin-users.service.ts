import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasteepAuthService } from '../tasteep/auth/tasteep-auth.service';
import { TasteepSession } from '../tasteep/entities/tasteep-session.entity';
import { TasteepTasting } from '../tasteep/entities/tasteep-tasting.entity';
import { TasteepUser } from '../tasteep/entities/tasteep-user.entity';
import { UsersQueryDto } from './dto/admin-queries.dto';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export const toAdminUserJson = (u: TasteepUser, tastingCount: number) => ({
  id: u.id,
  email: u.email,
  display_name: u.displayName,
  provider: u.provider,
  tasting_count: tastingCount,
  created_at: iso(u.createdAt),
});

export const toAdminSessionJson = (s: TasteepSession) => ({
  id: s.id,
  user_id: s.userId,
  created_at: iso(s.createdAt),
  expires_at: iso(s.expiresAt),
  revoked_at: isoOrNull(s.revokedAt),
  last_seen_at: isoOrNull(s.lastSeenAt),
});

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(TasteepUser)
    private readonly userRepo: Repository<TasteepUser>,
    @InjectRepository(TasteepSession)
    private readonly sessionRepo: Repository<TasteepSession>,
    @InjectRepository(TasteepTasting)
    private readonly tastingRepo: Repository<TasteepTasting>,
    private readonly authService: TasteepAuthService,
  ) {}

  async list(query: UsersQueryDto) {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .orderBy('u.createdAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);
    if (query.provider) qb.andWhere('u.provider = :p', { p: query.provider });
    if (query.q) {
      qb.andWhere('(u.email ILIKE :q OR u.displayName ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }
    const [users, total] = await qb.getManyAndCount();

    const counts = new Map<string, number>();
    if (users.length > 0) {
      const rows = await this.tastingRepo
        .createQueryBuilder('t')
        .select('t.userId', 'user_id')
        .addSelect('COUNT(*)', 'count')
        .where('t.userId IN (:...ids)', { ids: users.map((u) => u.id) })
        .groupBy('t.userId')
        .getRawMany<{ user_id: string; count: string }>();
      for (const r of rows) counts.set(r.user_id, Number(r.count));
    }

    return {
      items: users.map((u) => toAdminUserJson(u, counts.get(u.id) ?? 0)),
      total,
    };
  }

  async detail(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found.');
    const [sessions, tastingCount] = await Promise.all([
      this.sessionRepo.find({
        where: { userId: id },
        order: { createdAt: 'DESC' },
        take: 50,
      }),
      this.tastingRepo.count({ where: { userId: id } }),
    ]);
    return {
      ...toAdminUserJson(user, tastingCount),
      sessions: sessions.map(toAdminSessionJson),
    };
  }

  async revokeSession(sessionId: string): Promise<{ revoked: boolean }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found.');
    return { revoked: await this.authService.revokeSession(sessionId) };
  }

  async revokeAll(userId: string): Promise<{ revoked: number }> {
    const exists = await this.userRepo.count({ where: { id: userId } });
    if (!exists) throw new NotFoundException('User not found.');
    return { revoked: await this.authService.revokeAllForUser(userId) };
  }
}
