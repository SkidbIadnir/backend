import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import {
  ScrapeRunTrigger,
  TasteepSmwsScrapeRun,
} from '../entities/tasteep-smws-scrape-run.entity';
import { RegionsService } from '../regions/regions.service';
import {
  parseAbv,
  parseDistilledDate,
  parsePrice,
  splitSmwsCode,
  textOrNull,
} from './smws-bottle.parse';
import {
  applyStockChecks,
  DEFAULT_SYNC_RULES,
  planSync,
  StockCheck,
  stockCheckCandidates,
  SyncPlan,
  SyncRules,
} from './smws-bottle-sync.rules';
import {
  ScrapedBottle,
  SmwsSiteScraper,
  SmwsSiteSession,
} from './smws-site.scraper';

/** Session-level Postgres advisory lock: one scrape at a time across every process on the database. */
const SCRAPE_LOCK_KEY = 727_455_001;
/** Page checks per run; beyond this the plain miss rule applies. */
const MAX_STOCK_CHECKS = 50;

/** A bottle row ready to insert or update, from a freshly read bottle page. */
export type FreshBottle = Pick<
  TasteepSmwsBottle,
  | 'code'
  | 'distilleryCode'
  | 'caskNo'
  | 'name'
  | 'url'
  | 'priceText'
  | 'priceAmount'
  | 'priceCurrency'
  | 'abv'
  | 'age'
  | 'caskType'
  | 'distilledDate'
  | 'profile'
  | 'regionText'
  | 'regionId'
>;

export interface ApplyResult {
  added: number;
  relisted: number;
  missed: number;
  delisted: number;
}

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

/**
 * Runs the SMWS scrape and turns it into `tasteep_smws_bottles` changes:
 * list → plan (`planSync`) → read unknown bottle pages → apply everything in
 * one transaction. Each run is logged in `tasteep_smws_scrape_runs`.
 */
@Injectable()
export class SmwsBottleSyncService implements OnModuleInit {
  private readonly logger = new Logger(SmwsBottleSyncService.name);
  private readonly rules: SyncRules = DEFAULT_SYNC_RULES;
  private running = false;
  /** URLs whose page had no cask code; skipped until the process restarts. */
  private readonly notBottles = new Set<string>();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TasteepSmwsBottle)
    private readonly bottles: Repository<TasteepSmwsBottle>,
    @InjectRepository(TasteepSmwsScrapeRun)
    private readonly runs: Repository<TasteepSmwsScrapeRun>,
    @InjectRepository(TasteepSmwsCode)
    private readonly codes: Repository<TasteepSmwsCode>,
    private readonly regions: RegionsService,
    private readonly site: SmwsSiteScraper,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.closeInterruptedRuns();
    } catch (error) {
      this.logger.error(
        `Could not close interrupted runs: ${errorMessage(error)}`,
      );
    }
  }

  /** True while this process is running a scrape. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Runs one scrape. Resolves to the logged run, or `null` when a run is
   * already in progress here or in another process. Never rejects: failures
   * are recorded on the run row.
   */
  async run(trigger: ScrapeRunTrigger): Promise<TasteepSmwsScrapeRun | null> {
    if (this.running) {
      this.logger.warn(`Scrape (${trigger}) skipped: a run is in progress.`);
      return null;
    }
    this.running = true; // set before the first await so callers see it at once
    try {
      const run = await this.withLock(() => this.execute(trigger));
      if (run === undefined) {
        this.logger.warn(
          `Scrape (${trigger}) skipped: another process holds the lock.`,
        );
      }
      return run ?? null;
    } catch (error) {
      this.logger.error(`Scrape (${trigger}) failed: ${errorMessage(error)}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** `running` rows left by a process that died: nobody holds the lock, so none is really running. */
  async closeInterruptedRuns(): Promise<void> {
    await this.withLock(async () => {
      const { affected } = await this.runs.update(
        { status: 'running' },
        {
          status: 'failed',
          finishedAt: new Date(),
          error: 'Interrupted: the process stopped before the run finished.',
        },
      );
      if (affected) {
        this.logger.warn(`Marked ${affected} interrupted run(s) as failed.`);
      }
    });
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = (await runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [SCRAPE_LOCK_KEY],
      )) as { locked: boolean }[];
      if (!rows[0]?.locked) return undefined;
      try {
        return await fn();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [SCRAPE_LOCK_KEY]);
      }
    } finally {
      await runner.release();
    }
  }

  private async execute(
    trigger: ScrapeRunTrigger,
  ): Promise<TasteepSmwsScrapeRun> {
    const run = await this.runs.save(
      this.runs.create({ trigger, status: 'running', startedAt: new Date() }),
    );
    this.logger.log(`Scrape #${run.id} (${trigger}) started.`);

    let session: SmwsSiteSession | undefined;
    try {
      session = await this.site.open();
      const listing = await session.listProducts();
      run.pages = listing.pages;
      run.listed = listing.urls.length;

      const known = await this.bottles.find({
        select: {
          code: true,
          url: true,
          delistedAt: true,
          consecutiveMisses: true,
        },
      });
      const listingPlan = planSync(
        known,
        listing.urls,
        listing.complete,
        this.rules,
      );
      // Before a miss counts, ask the bottle's own page whether it is still in stock.
      const plan = applyStockChecks(
        listingPlan,
        await this.checkStock(
          session,
          stockCheckCandidates(listingPlan),
          new Map(known.map((b) => [b.code, b.url])),
        ),
      );
      run.confirmed = plan.confirmed.length;
      const { pages: read, failed } = await this.readBottlePages(
        session,
        plan.unknownUrls.filter((url) => !this.notBottles.has(url)),
      );
      await session.close();
      session = undefined;

      const fresh = await this.toFreshBottles(read);
      const now = new Date();
      const result = await this.dataSource.transaction((m) =>
        this.apply(m, plan, fresh, now),
      );

      Object.assign(run, result, {
        status: plan.trusted ? 'succeeded' : 'partial',
        note:
          [
            plan.untrustedReason,
            failed ? `${failed} bottle page(s) failed to load.` : null,
          ]
            .filter(Boolean)
            .join(' ') || null,
      });
    } catch (error) {
      run.status = 'failed';
      run.error = errorMessage(error);
    } finally {
      await session?.close().catch(() => undefined);
    }

    run.finishedAt = new Date();
    await this.runs.save(run);
    this.logger.log(
      `Scrape #${run.id} ${run.status}: listed ${run.listed ?? '-'}, added ${run.added ?? 0}, relisted ${run.relisted ?? 0}, missed ${run.missed ?? 0}, delisted ${run.delisted ?? 0}${run.note ? ` — ${run.note}` : ''}${run.error ? ` — ${run.error}` : ''}`,
    );
    return run;
  }

  /** Page check for each candidate; any error counts as unknown (`null`). */
  private async checkStock(
    session: SmwsSiteSession,
    codes: string[],
    urlByCode: Map<string, string>,
  ): Promise<Map<string, StockCheck>> {
    const checks = new Map<string, StockCheck>();
    for (const code of codes.slice(0, MAX_STOCK_CHECKS)) {
      const url = urlByCode.get(code);
      if (!url) continue;
      try {
        checks.set(code, await session.checkStock(url));
      } catch (error) {
        checks.set(code, null);
        this.logger.warn(
          `Stock check ${code} (${url}): ${errorMessage(error)}`,
        );
      }
    }
    if (codes.length) {
      const count = (v: StockCheck) =>
        [...checks.values()].filter((c) => c === v).length;
      this.logger.log(
        `Stock checks for ${codes.length} missing bottle(s): ${count(true)} in stock, ${count(false)} out of stock, ${count(null)} unknown${codes.length > MAX_STOCK_CHECKS ? ` (only the first ${MAX_STOCK_CHECKS} checked)` : ''}.`,
      );
    }
    return checks;
  }

  private async readBottlePages(
    session: SmwsSiteSession,
    urls: string[],
  ): Promise<{
    pages: { url: string; page: ScrapedBottle }[];
    failed: number;
  }> {
    const pages: { url: string; page: ScrapedBottle }[] = [];
    let failed = 0;
    for (const [i, url] of urls.entries()) {
      try {
        const page = await session.readBottle(url);
        if (page) pages.push({ url, page });
        else this.notBottles.add(url);
      } catch (error) {
        failed++;
        this.logger.warn(
          `[${i + 1}/${urls.length}] ${url}: ${errorMessage(error)}`,
        );
      }
    }
    return { pages, failed };
  }

  /** Parses raw pages into rows and links each to its region (text first, then the distillery code's). */
  async toFreshBottles(
    read: { url: string; page: ScrapedBottle }[],
  ): Promise<FreshBottle[]> {
    const parsed = read.flatMap(({ url, page }) => {
      const code = splitSmwsCode(page.code);
      const name = textOrNull(page.name);
      return code && name ? [{ url, page, code, name }] : [];
    });
    const codeRegions = new Map(
      parsed.length
        ? (
            await this.codes.find({
              where: {
                code: In([
                  ...new Set(parsed.map((p) => p.code.distilleryCode)),
                ]),
              },
            })
          ).map((c) => [c.code, c.regionId])
        : [],
    );

    const resolved = new Map<string, string | null>();
    const fresh = new Map<string, FreshBottle>(); // by code: two URLs can lead to one cask
    for (const { url, page, code, name } of parsed) {
      const regionText = textOrNull(page.regionText);
      if (regionText && !resolved.has(regionText)) {
        resolved.set(
          regionText,
          (await this.regions.resolve(null, regionText))?.id ?? null,
        );
      }
      const price = parsePrice(page.priceText);
      fresh.set(code.code, {
        code: code.code,
        distilleryCode: code.distilleryCode,
        caskNo: code.caskNo,
        name,
        url,
        priceText: textOrNull(page.priceText),
        priceAmount: price.amount,
        priceCurrency: price.currency,
        abv: parseAbv(page.abvText),
        age: textOrNull(page.age),
        caskType: textOrNull(page.caskType),
        distilledDate: parseDistilledDate(page.distilledText),
        profile: textOrNull(page.profile),
        regionText,
        regionId:
          (regionText ? resolved.get(regionText) : null) ??
          codeRegions.get(code.distilleryCode) ??
          null,
      });
    }
    return [...fresh.values()];
  }

  /**
   * Writes a run's outcome. A freshly read bottle wins over the plan: when a
   * known code turns up under a new URL, the plan saw its old URL missing,
   * but the bottle is listed, so it is not counted as missed or delisted.
   */
  async apply(
    m: EntityManager,
    plan: SyncPlan,
    fresh: FreshBottle[],
    now: Date,
  ): Promise<ApplyResult> {
    const freshCodes = new Set(fresh.map((b) => b.code));
    const previous = new Map(
      fresh.length
        ? (
            await m.find(TasteepSmwsBottle, {
              select: { code: true, delistedAt: true },
              where: { code: In([...freshCodes]) },
            })
          ).map((b) => [b.code, b])
        : [],
    );

    if (plan.seen.length) {
      await m.update(
        TasteepSmwsBottle,
        { code: In(plan.seen) },
        { lastSeenAt: now, consecutiveMisses: 0, delistedAt: null },
      );
    }

    const missed = plan.missed.filter((b) => !freshCodes.has(b.code));
    const byCount = new Map<number, string[]>();
    for (const { code, misses } of missed) {
      byCount.set(misses, [...(byCount.get(misses) ?? []), code]);
    }
    for (const [misses, codes] of byCount) {
      await m.update(
        TasteepSmwsBottle,
        { code: In(codes) },
        { consecutiveMisses: misses },
      );
    }

    const delisted = plan.delisted.filter((code) => !freshCodes.has(code));
    if (delisted.length) {
      await m.update(
        TasteepSmwsBottle,
        { code: In(delisted) },
        {
          delistedAt: now,
          consecutiveMisses: this.rules.missesBeforeDelist,
        },
      );
    }

    let added = 0;
    let relisted = plan.relisted.length;
    for (const bottle of fresh) {
      const before = previous.get(bottle.code);
      const seen = { lastSeenAt: now, consecutiveMisses: 0, delistedAt: null };
      if (before) {
        if (before.delistedAt) relisted++;
        await m.update(
          TasteepSmwsBottle,
          { code: bottle.code },
          { ...bottle, ...seen },
        );
      } else {
        added++;
        await m.insert(TasteepSmwsBottle, {
          ...bottle,
          ...seen,
          firstSeenAt: now,
        });
      }
    }

    return {
      added,
      relisted,
      missed: missed.length,
      delisted: delisted.length,
    };
  }
}
