/**
 * Wire shapes of the admin API. Classes (not interfaces) so the Swagger plugin
 * can emit them into `/admin/openapi.json`, which the dashboard generates its
 * typed client from. Keep these in step with the services' return values.
 */
import type { AuthProvider } from '../../tasteep/entities/tasteep-user.entity';
import type {
  LocationPrecision,
  TastingCategory,
} from '../../tasteep/entities/tasteep-tasting.entity';
import type { LogLevel } from '../logging/log-buffer';

export class AdminSessionJson {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string | null;
}

export class AdminUserJson {
  id: string;
  email: string | null;
  display_name: string;
  provider: AuthProvider;
  tasting_count: number;
  created_at: string;
}

export class AdminUserDetailJson extends AdminUserJson {
  sessions: AdminSessionJson[];
}

export class AdminUserPage {
  items: AdminUserJson[];
  total: number;
}

export class AdminTastingJson {
  id: string;
  user_id: string;
  name: string;
  category: TastingCategory;
  score: number | null;
  distillery: string | null;
  region: string | null;
  region_id: string | null;
  location: string | null;
  lat: number | null;
  lon: number | null;
  location_precision: LocationPrecision;
  date_tasted: string | null;
  created_at: string;
}

export class AdminTastingPage {
  items: AdminTastingJson[];
  total: number;
}

export class GeocodeMissJson {
  query: string;
  precision: LocationPrecision;
  provider: string;
  resolved_at: string;
}

export class GeocodeMissPage {
  items: GeocodeMissJson[];
  total: number;
}

export class ProviderCount {
  provider: AuthProvider;
  count: number;
}
export class DayCount {
  day: string;
  count: number;
}
export class DayCategoryCount {
  day: string;
  category: TastingCategory;
  count: number;
}
export class ScoreBucket {
  /** Lower bound of a 10-point bucket: 0, 10, … 90. */
  bucket: number;
  count: number;
}
export class TagCount {
  tag: string;
  count: number;
}
export class DistilleryCount {
  distillery: string;
  count: number;
}
export class StatsTotals {
  users: number;
  tastings: number;
}
export class ActiveSessions {
  last_7d: number;
  last_30d: number;
}

export class StatsOverviewJson {
  totals: StatsTotals;
  users_by_provider: ProviderCount[];
  signups_per_day: DayCount[];
  active_sessions: ActiveSessions;
  tastings_per_day: DayCategoryCount[];
  score_histogram: ScoreBucket[];
  top_tags: TagCount[];
  top_distilleries: DistilleryCount[];
}

export class OtpStatsJson {
  total: number;
  consumed: number;
  expired: number;
  pending: number;
  /** Locked out by too many wrong guesses. */
  failed: number;
  last_24h: number;
}

export class ScraperRunJson {
  running: boolean;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_error: string | null;
}
export class SmwsLiveStatus {
  total: number;
  available: number;
  new: number;
  updated_at: string | null;
}
export class SmwsArchiveStatus {
  total: number;
  new: number;
  updated_at: string | null;
}
export class SmwsDistilleryStatus {
  total: number;
  updated_at: string | null;
}
export class SmwsLookoutStatus {
  total: number;
}
export class SmwsScraperStatus {
  live: ScraperRunJson;
  archive: ScraperRunJson;
}
export class SmwsStatusJson {
  live: SmwsLiveStatus;
  archive: SmwsArchiveStatus;
  distilleries: SmwsDistilleryStatus;
  lookout: SmwsLookoutStatus;
  scraper: SmwsScraperStatus;
}

export class RevokeSessionResultJson {
  /** False when the session existed but was already revoked. */
  revoked: boolean;
}
export class RevokeAllResultJson {
  revoked: number;
}
export class ScraperStartedJson {
  started: boolean;
}

export class LogEntryJson {
  ts: string;
  level: LogLevel;
  context: string | null;
  message: string;
}
export class LogPage {
  items: LogEntryJson[];
  total: number;
}

export class AdminSmwsCodeJson {
  code: string;
  distillery_name: string;
  category: string;
  region: string | null;
  region_id: string | null;
  extra: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
export class AdminSmwsCodePage {
  items: AdminSmwsCodeJson[];
  total: number;
}

export class SmwsCodeFieldDiff {
  field: string;
  json: string | null;
  table: string | null;
}
export class SmwsCodeChange {
  code: string;
  fields: SmwsCodeFieldDiff[];
}
export class SmwsCodesDiffJson {
  in_sync: boolean;
  /** In the seed file, not in the table: inserted on the next boot. */
  only_in_json: string[];
  /** Live in the table, absent from the seed file (added from the dashboard). */
  only_in_table: string[];
  /** In the seed file but deleted from the dashboard; the seed won't bring them back. */
  deleted_in_table: string[];
  /** In both, with different values. */
  changed: SmwsCodeChange[];
}
