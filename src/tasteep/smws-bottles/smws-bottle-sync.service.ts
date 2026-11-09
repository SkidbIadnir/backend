import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, DataSource, LessThan, MoreThan, Repository } from 'typeorm';
import { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import {
  SmwsPageKind,
  TasteepSmwsPage,
} from '../entities/tasteep-smws-page.entity';
import {
  ScrapeRunTrigger,
  TasteepSmwsScrapeRun,
} from '../entities/tasteep-smws-scrape-run.entity';
import { RegionsService } from '../regions/regions.service';
import {
  BottleRead,
  mergeBottle,
  readBottle,
  StoredBottle,
  stockChange,
} from './smws-catalog.rules';
import { SmwsHttpClient } from './smws-http.client';
import { parseProductPage } from './smws-product.parser';

/** Session-level Postgres advisory lock: one scrape at a time across every process on the database. */
const SCRAPE_LOCK_KEY = 727_455_001;
/** Sold-out bottles are re-read for a relist while sold out for less than this… */
const RELIST_WINDOW_DAYS = 30;
/** …and at most once per this many days. */
const RELIST_CHECK_EVERY_DAYS = 7;
/** Pages read as `other` (no ABV) are read again after this many days. */
const OTHER_RECHECK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RunCounters {
  discovered: number;
  added: number;
  checked: number;
  relisted: number;
  delisted: number;
  failed: number;
}

type Purpose = 'discover' | 'check';

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

/**
 * Keeps `tasteep_smws_catalog` in line with smws.eu using public pages only:
 *  1. discovery — every sitemap URL never read before is read once and
 *     recorded in `tasteep_smws_pages` (bottle, other or gone);
 *  2. stock check — every in-stock bottle's page is re-read: stock, price
 *     and any newly filled field;
 *  3. relist sweep — bottles sold out in the last 30 days are re-read
 *     weekly in case they come back;
 *  4. pages read as `other` (no ABV) are re-read monthly.
 * Availability is the page's own stock flag. Each page is written as soon as
 * it is read, so an interrupted run (the first one reads ~2,500 pages) resumes
 * where it stopped. A failed read changes nothing and is retried next run.
 */
@Injectable()
export class SmwsBottleSyncService implements OnModuleInit {
  private readonly logger = new Logger(SmwsBottleSyncService.name);
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TasteepSmwsBottle)
    private readonly bottles: Repository<TasteepSmwsBottle>,
    @InjectRepository(TasteepSmwsPage)
    private readonly pages: Repository<TasteepSmwsPage>,
    @InjectRepository(TasteepSmwsScrapeRun)
    private readonly runs: Repository<TasteepSmwsScrapeRun>,
    @InjectRepository(TasteepSmwsCode)
    private readonly codes: Repository<TasteepSmwsCode>,
    private readonly regions: RegionsService,
    private readonly http: SmwsHttpClient,
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
    const counters: RunCounters = {
      discovered: 0,
      added: 0,
      checked: 0,
      relisted: 0,
      delisted: 0,
      failed: 0,
    };
    const notes: string[] = [];
    const cache = new RegionCache(this.regions, this.codes);

    try {
      // 1. Discovery.
      let sitemap: string[] = [];
      let sitemapOk = false;
      try {
        sitemap = await this.http.productUrls();
        run.sitemapUrls = sitemap.length;
        sitemapOk = true;
      } catch (error) {
        notes.push(
          `Sitemap unavailable (${errorMessage(error)}): no discovery this run.`,
        );
      }
      const known = new Set(
        (await this.pages.find({ select: { url: true } })).map((p) => p.url),
      );
      const unknown = sitemap.filter((url) => !known.has(url));
      if (unknown.length) {
        this.logger.log(
          `Scrape #${run.id}: reading ${unknown.length} new page(s).`,
        );
      }
      for (const url of unknown) {
        counters.discovered++;
        await this.readAndStore(url, 'discover', counters, cache);
        if (counters.discovered % 100 === 0) {
          this.logger.log(
            `Scrape #${run.id}: ${counters.discovered}/${unknown.length} new page(s) read, ${counters.added} bottle(s) added, ${counters.failed} failed.`,
          );
        }
      }

      // 2. Stock check of every in-stock bottle not read above.
      const inStock = await this.bottles.find({
        select: { sku: true, url: true },
        where: { inStock: true, lastSeenAt: LessThan(run.startedAt) },
      });
      // 3. Relist sweep of recently sold-out bottles.
      const now = Date.now();
      const soldOut = await this.bottles.find({
        select: { sku: true, url: true },
        where: {
          inStock: false,
          delistedAt: MoreThan(new Date(now - RELIST_WINDOW_DAYS * DAY_MS)),
          lastSeenAt: And(
            LessThan(new Date(now - RELIST_CHECK_EVERY_DAYS * DAY_MS)),
            LessThan(run.startedAt),
          ),
        },
      });
      for (const { url } of [...inStock, ...soldOut]) {
        counters.checked++;
        await this.readAndStore(url, 'check', counters, cache);
      }

      // 4. Non-bottle pages get a monthly second look (a product can gain its ABV later).
      const others = await this.pages.find({
        select: { url: true },
        where: {
          kind: 'other',
          lastReadAt: LessThan(new Date(now - OTHER_RECHECK_DAYS * DAY_MS)),
        },
      });
      for (const { url } of others) {
        counters.checked++;
        await this.readAndStore(url, 'discover', counters, cache);
      }

      if (counters.failed) {
        notes.push(`${counters.failed} page read(s) failed; retried next run.`);
      }
      Object.assign(run, counters, {
        status: counters.failed || !sitemapOk ? 'partial' : 'succeeded',
        note: notes.join(' ') || null,
      });
    } catch (error) {
      Object.assign(run, counters, {
        status: 'failed',
        error: errorMessage(error),
        note: notes.join(' ') || null,
      });
    }

    run.finishedAt = new Date();
    await this.runs.save(run);
    this.logger.log(
      `Scrape #${run.id} ${run.status}: sitemap ${run.sitemapUrls ?? '-'}, discovered ${counters.discovered}, added ${counters.added}, checked ${counters.checked}, relisted ${counters.relisted}, delisted ${counters.delisted}, failed ${counters.failed}${run.note ? ` — ${run.note}` : ''}${run.error ? ` — ${run.error}` : ''}`,
    );
    return run;
  }

  /**
   * Reads one page and stores what it says. Never throws: a failure is
   * counted and changes nothing. During a `check`, a page that no longer
   * looks like a bottle is a failure too, never a reason to change the row.
   */
  async readAndStore(
    url: string,
    purpose: Purpose,
    counters: RunCounters,
    cache: RegionCache,
  ): Promise<void> {
    try {
      const res = await this.http.get(url);
      const now = new Date();
      if (res.status === 404 || res.status === 410) {
        await this.markGone(url, now, counters);
        return;
      }
      if (!res.body) {
        counters.failed++;
        this.logger.warn(`${url}: HTTP ${res.status}`);
        return;
      }
      const parsed = parseProductPage(res.body);
      const read = parsed ? readBottle(parsed, url) : null;
      if (!read) {
        // A known bottle whose page stops looking like one is a bad read, not a change.
        if (purpose === 'check') {
          counters.failed++;
          this.logger.warn(`${url}: no bottle data on a known bottle's page`);
          return;
        }
        await this.savePage(url, 'other', null, now);
        return;
      }
      await this.storeBottle(read, now, counters, cache);
    } catch (error) {
      counters.failed++;
      this.logger.warn(`${url}: ${errorMessage(error)}`);
    }
  }

  private async storeBottle(
    read: BottleRead,
    now: Date,
    counters: RunCounters,
    cache: RegionCache,
  ): Promise<void> {
    const stored =
      (await this.bottles.findOne({ where: { sku: read.sku } })) ??
      (read.code
        ? await this.bottles.findOne({ where: { code: read.code } })
        : null);
    // Region from the merged fields: a page without region text keeps the
    // stored text, so the stored (more precise) region is not downgraded.
    const draft = mergeBottle(stored ? toStored(stored) : null, read, null);
    const merged = {
      ...draft,
      regionId:
        (await cache.resolve(draft.regionText, draft.distilleryCode)) ??
        draft.regionId,
    };
    const change = stockChange(stored, merged);

    await this.dataSource.transaction(async (m) => {
      await m.save(TasteepSmwsBottle, {
        ...merged,
        firstSeenAt: stored?.firstSeenAt ?? now,
        lastSeenAt: now,
        delistedAt:
          change === 'delisted'
            ? now
            : change === 'relisted'
              ? null
              : (stored?.delistedAt ?? null),
      });
      await this.savePage(
        read.url,
        'bottle',
        merged.sku,
        now,
        m.getRepository(TasteepSmwsPage),
      );
    });

    if (!stored) counters.added++;
    if (change) counters[change]++;
  }

  /** 404/410: the page is gone. A known in-stock bottle on it is delisted. */
  private async markGone(
    url: string,
    now: Date,
    counters: RunCounters,
  ): Promise<void> {
    const bottle = await this.bottles.findOne({ where: { url } });
    if (bottle?.inStock) {
      await this.bottles.update(
        { sku: bottle.sku },
        { inStock: false, stock: 0, delistedAt: now },
      );
      counters.delisted++;
    }
    await this.savePage(url, 'gone', bottle?.sku ?? null, now);
  }

  private async savePage(
    url: string,
    kind: SmwsPageKind,
    sku: string | null,
    now: Date,
    repo: Repository<TasteepSmwsPage> = this.pages,
  ): Promise<void> {
    await repo
      .createQueryBuilder()
      .insert()
      .values({ url, kind, sku, firstReadAt: now, lastReadAt: now })
      .orUpdate(['kind', 'sku', 'last_read_at'], ['url'])
      .execute();
  }
}

const toStored = (b: TasteepSmwsBottle): StoredBottle => ({
  sku: b.sku,
  productId: b.productId,
  url: b.url,
  kind: b.kind,
  code: b.code,
  distilleryCode: b.distilleryCode,
  caskNo: b.caskNo,
  batch: b.batch,
  name: b.name,
  priceText: b.priceText,
  priceAmount: b.priceAmount,
  priceCurrency: b.priceCurrency,
  abv: b.abv,
  age: b.age,
  caskType: b.caskType,
  distilledDate: b.distilledDate,
  profile: b.profile,
  regionText: b.regionText,
  regionId: b.regionId,
  categories: b.categories ?? [],
  releasedAt: b.releasedAt,
  inStock: b.inStock,
  stock: b.stock,
});

/** Region text → curated region id, falling back to the distillery code's region; cached per run. */
export class RegionCache {
  private readonly byText = new Map<string, string | null>();
  private readonly byCode = new Map<string, string | null>();

  constructor(
    private readonly regions: RegionsService,
    private readonly codes: Repository<TasteepSmwsCode>,
  ) {}

  async resolve(
    regionText: string | null,
    distilleryCode: string | null,
  ): Promise<string | null> {
    if (regionText) {
      if (!this.byText.has(regionText)) {
        this.byText.set(
          regionText,
          (await this.regions.resolve(null, regionText))?.id ?? null,
        );
      }
      const id = this.byText.get(regionText);
      if (id) return id;
    }
    if (distilleryCode) {
      if (!this.byCode.has(distilleryCode)) {
        const code = await this.codes.findOne({
          where: { code: distilleryCode },
        });
        this.byCode.set(distilleryCode, code?.regionId ?? null);
      }
      return this.byCode.get(distilleryCode) ?? null;
    }
    return null;
  }
}
