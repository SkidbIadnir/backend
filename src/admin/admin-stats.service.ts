import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasteepEmailOtp } from '../tasteep/entities/tasteep-email-otp.entity';
import { TasteepSession } from '../tasteep/entities/tasteep-session.entity';
import {
  TasteepTasting,
  TastingCategory,
} from '../tasteep/entities/tasteep-tasting.entity';
import {
  AuthProvider,
  TasteepUser,
} from '../tasteep/entities/tasteep-user.entity';
import { tasteepConfig } from '../tasteep/tasteep-config';

const DAYS = 30;
const num = (v: unknown) => Number(v ?? 0);

// Postgres returns COUNT(*) as a bigint string, hence `unknown` + num() below.
type Row<K extends string> = Record<K, string | number | null>;
type Count = Row<'count'>;

@Injectable()
export class AdminStatsService {
  constructor(
    @InjectRepository(TasteepUser)
    private readonly userRepo: Repository<TasteepUser>,
    @InjectRepository(TasteepSession)
    private readonly sessionRepo: Repository<TasteepSession>,
    @InjectRepository(TasteepTasting)
    private readonly tastingRepo: Repository<TasteepTasting>,
    @InjectRepository(TasteepEmailOtp)
    private readonly otpRepo: Repository<TasteepEmailOtp>,
  ) {}

  async overview() {
    const [
      usersByProvider,
      signupsPerDay,
      active,
      tastingsPerDay,
      scoreHistogram,
      topTags,
      topDistilleries,
      totals,
    ] = await Promise.all([
      this.userRepo.query<Array<{ provider: AuthProvider } & Count>>(
        `SELECT provider, COUNT(*) AS count FROM tasteep_users GROUP BY provider ORDER BY count DESC`,
      ),
      this.userRepo.query<Array<{ day: string } & Count>>(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*) AS count
           FROM tasteep_users WHERE created_at >= now() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 1`,
        [DAYS],
      ),
      this.sessionRepo.query<[Row<'d7'> & Row<'d30'>]>(
        `SELECT
           COUNT(*) FILTER (WHERE last_seen_at >= now() - interval '7 days') AS d7,
           COUNT(*) FILTER (WHERE last_seen_at >= now() - interval '30 days') AS d30
         FROM tasteep_sessions WHERE revoked_at IS NULL AND expires_at > now()`,
      ),
      this.tastingRepo.query<
        Array<{ day: string; category: TastingCategory } & Count>
      >(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, category, COUNT(*) AS count
           FROM tasteep_tastings WHERE created_at >= now() - ($1 || ' days')::interval
          GROUP BY 1, 2 ORDER BY 1, 2`,
        [DAYS],
      ),
      this.tastingRepo.query<Array<Row<'bucket'> & Count>>(
        `SELECT (LEAST(score, 99) / 10) * 10 AS bucket, COUNT(*) AS count
           FROM tasteep_tastings WHERE score IS NOT NULL GROUP BY 1 ORDER BY 1`,
      ),
      this.tastingRepo.query<Array<{ tag: string } & Count>>(
        `SELECT tag, COUNT(*) AS count FROM tasteep_tastings, unnest(tags) AS tag
          GROUP BY tag ORDER BY count DESC, tag LIMIT 10`,
      ),
      this.tastingRepo.query<Array<{ distillery: string } & Count>>(
        `SELECT distillery, COUNT(*) AS count FROM tasteep_tastings
          WHERE distillery IS NOT NULL AND distillery <> ''
          GROUP BY distillery ORDER BY count DESC, distillery LIMIT 10`,
      ),
      this.tastingRepo.query<[Row<'users'> & Row<'tastings'>]>(
        `SELECT (SELECT COUNT(*) FROM tasteep_users) AS users,
                (SELECT COUNT(*) FROM tasteep_tastings) AS tastings`,
      ),
    ]);

    return {
      totals: {
        users: num(totals[0].users),
        tastings: num(totals[0].tastings),
      },
      users_by_provider: usersByProvider.map((r) => ({
        provider: r.provider,
        count: num(r.count),
      })),
      signups_per_day: signupsPerDay.map((r) => ({
        day: r.day,
        count: num(r.count),
      })),
      active_sessions: {
        last_7d: num(active[0].d7),
        last_30d: num(active[0].d30),
      },
      tastings_per_day: tastingsPerDay.map((r) => ({
        day: r.day,
        category: r.category,
        count: num(r.count),
      })),
      score_histogram: scoreHistogram.map((r) => ({
        bucket: num(r.bucket),
        count: num(r.count),
      })),
      top_tags: topTags.map((r) => ({ tag: r.tag, count: num(r.count) })),
      top_distilleries: topDistilleries.map((r) => ({
        distillery: r.distillery,
        count: num(r.count),
      })),
    };
  }

  /** Health of the email-OTP login flow. "Failed" = locked out by too many wrong guesses. */
  async otpStats() {
    const [row] = await this.otpRepo.query<
      [
        Row<'total'> &
          Row<'consumed'> &
          Row<'expired'> &
          Row<'pending'> &
          Row<'failed'> &
          Row<'last_24h'>,
      ]
    >(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE consumed_at IS NOT NULL) AS consumed,
         COUNT(*) FILTER (WHERE consumed_at IS NULL AND expires_at <= now()) AS expired,
         COUNT(*) FILTER (WHERE consumed_at IS NULL AND expires_at > now()) AS pending,
         COUNT(*) FILTER (WHERE consumed_at IS NULL AND attempts >= $1) AS failed,
         COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS last_24h
       FROM tasteep_email_otps`,
      [tasteepConfig.otpMaxAttempts],
    );
    return {
      total: num(row.total),
      consumed: num(row.consumed),
      expired: num(row.expired),
      pending: num(row.pending),
      failed: num(row.failed),
      last_24h: num(row.last_24h),
    };
  }
}
