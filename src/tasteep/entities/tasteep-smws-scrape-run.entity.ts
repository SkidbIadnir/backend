import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const SCRAPE_RUN_TRIGGERS = ['cron', 'admin'] as const;
export type ScrapeRunTrigger = (typeof SCRAPE_RUN_TRIGGERS)[number];

/**
 * - `running`   — in progress (or the process died; fixed up at the next boot)
 * - `succeeded` — every step ran and every page read worked
 * - `partial`   — the run finished but the sitemap or some page reads failed;
 *                 those pages are retried next run and nothing was changed for them
 * - `failed`    — threw before finishing
 */
export const SCRAPE_RUN_STATUSES = [
  'running',
  'succeeded',
  'partial',
  'failed',
] as const;
export type ScrapeRunStatus = (typeof SCRAPE_RUN_STATUSES)[number];

/**
 * One scraper run, kept as a log so availability changes can be explained
 * after the fact. Columns from the Playwright era (`pages`, `listed`,
 * `missed`, `confirmed`) stay nullable for the old rows.
 */
@Entity('tasteep_smws_scrape_runs')
@Index('tasteep_smws_scrape_runs_started_at_idx', ['startedAt'])
export class TasteepSmwsScrapeRun {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'text' })
  trigger: ScrapeRunTrigger;

  @Column({ type: 'text', default: 'running' })
  status: ScrapeRunStatus;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** Product URLs in the sitemap. */
  @Column({ name: 'sitemap_urls', type: 'integer', nullable: true })
  sitemapUrls: number | null;

  /** Never-seen URLs read this run. */
  @Column({ type: 'integer', nullable: true })
  discovered: number | null;

  /** Bottles saved for the first time. */
  @Column({ type: 'integer', nullable: true })
  added: number | null;

  /** Known bottles re-read for stock and price (in stock, or recently sold out). */
  @Column({ type: 'integer', nullable: true })
  checked: number | null;

  /** Out-of-stock bottles back in stock. */
  @Column({ type: 'integer', nullable: true })
  relisted: number | null;

  /** In-stock bottles now out of stock (or whose page is gone). */
  @Column({ type: 'integer', nullable: true })
  delisted: number | null;

  /** Page reads that failed; retried next run. */
  @Column({ type: 'integer', nullable: true })
  failed: number | null;

  // --- Playwright era, kept for old rows -----------------------------------
  @Column({ type: 'integer', nullable: true })
  pages: number | null;

  @Column({ type: 'integer', nullable: true })
  listed: number | null;

  @Column({ type: 'integer', nullable: true })
  missed: number | null;

  @Column({ type: 'integer', nullable: true })
  confirmed: number | null;

  /** Why a run is `partial`, or other remarks. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
