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

export class SmwsBottleCounts {
  total: number;
  available: number;
  /** Sold out: our archive. */
  delisted: number;
  single_casks: number;
  blends: number;
  without_region: number;
  /** Single casks whose code prefix is missing from `tasteep_smws_codes`. */
  unknown_distillery: number;
  last_seen_at: string | null;
}
export class SmwsPageCounts {
  /** Sitemap URLs that are bottles. */
  bottle: number;
  /** Product pages without an ABV (gift cards, glassware, packs). */
  other: number;
  /** Pages that answered 404. */
  gone: number;
}
export class SmwsScrapeRunJson {
  id: number;
  /** `cron` or `admin`. */
  trigger: string;
  /** `running`, `succeeded`, `partial` (sitemap or some page reads failed) or `failed`. */
  status: string;
  started_at: string;
  finished_at: string | null;
  /** Product URLs in the sitemap. */
  sitemap_urls: number | null;
  /** Never-seen URLs read this run. */
  discovered: number | null;
  /** Bottles saved for the first time. */
  added: number | null;
  /** Known bottles re-read for stock and price. */
  checked: number | null;
  relisted: number | null;
  delisted: number | null;
  /** Page reads that failed; retried next run. */
  failed: number | null;
  note: string | null;
  error: string | null;
}
export class SmwsScraperStatus {
  /** True while this process is scraping. */
  running: boolean;
  /** Latest 10 runs, newest first. */
  recent_runs: SmwsScrapeRunJson[];
}
export class SmwsStatusJson {
  bottles: SmwsBottleCounts;
  pages: SmwsPageCounts;
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

export class AdminDistilleryLocationJson {
  id: string;
  name: string;
  lat: number;
  lon: number;
  precision: 'exact' | 'region' | 'country';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
export class AdminDistilleryLocationPage {
  items: AdminDistilleryLocationJson[];
  total: number;
}
/** Create, update and restore: the row plus how many geocode cache rows the write evicted. */
export class AdminDistilleryLocationWriteJson extends AdminDistilleryLocationJson {
  cache_cleared: number;
}
export class DistilleryLocationDeletedJson {
  cache_cleared: number;
}
export class DistilleryLocationAppliedJson {
  id: string;
  /** Unplaced tastings that now carry this location. */
  updated: number;
}

export class SeedFieldDiff {
  field: string;
  json: string | number | string[] | null;
  table: string | number | string[] | null;
}
export class SeedRowChange {
  id: string;
  fields: SeedFieldDiff[];
}
/** Table vs bundled seed file, keyed on id. Same meaning as `SmwsCodesDiffJson`. */
export class SeedDiffJson {
  in_sync: boolean;
  only_in_json: string[];
  only_in_table: string[];
  deleted_in_table: string[];
  changed: SeedRowChange[];
}

export class AdminRegionRowJson {
  id: string;
  name: string;
  parent_id: string | null;
  lat: number | null;
  lon: number | null;
  sort_order: number;
  aliases: string[];
  deleted_at: string | null;
}
/** Counts are of rows linking to this node directly, not to its subregions. */
export class AdminRegionNodeJson extends AdminRegionRowJson {
  tasting_count: number;
  smws_code_count: number;
}
export class AdminRegionTreeJson extends AdminRegionNodeJson {
  subregions: AdminRegionNodeJson[];
}
