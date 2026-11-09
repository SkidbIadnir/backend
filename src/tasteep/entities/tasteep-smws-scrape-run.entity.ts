import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const SCRAPE_RUN_TRIGGERS = ['cron', 'admin'] as const;
export type ScrapeRunTrigger = (typeof SCRAPE_RUN_TRIGGERS)[number];

/**
 * - `running`   — in progress (or the process died; fixed up at the next boot)
 * - `succeeded` — listing trusted, availability fully applied
 * - `partial`   — listing not trusted (incomplete or suspiciously short):
 *                 seen bottles and new ones were saved, nothing was delisted
 * - `failed`    — threw before writing anything
 */
export const SCRAPE_RUN_STATUSES = [
  'running',
  'succeeded',
  'partial',
  'failed',
] as const;
export type ScrapeRunStatus = (typeof SCRAPE_RUN_STATUSES)[number];

/** One scraper run, kept as a log so availability changes can be explained after the fact. */
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

  /** Listing pages read. */
  @Column({ type: 'integer', nullable: true })
  pages: number | null;

  /** Distinct product URLs on the listing. */
  @Column({ type: 'integer', nullable: true })
  listed: number | null;

  /** Bottles saved for the first time. */
  @Column({ type: 'integer', nullable: true })
  added: number | null;

  /** Delisted bottles listed again. */
  @Column({ type: 'integer', nullable: true })
  relisted: number | null;

  /** Available bottles missing from a trusted listing (counted, not yet delisted). */
  @Column({ type: 'integer', nullable: true })
  missed: number | null;

  /** Bottles that reached the miss threshold this run. */
  @Column({ type: 'integer', nullable: true })
  delisted: number | null;

  /** Why a run is `partial`, or other remarks. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
