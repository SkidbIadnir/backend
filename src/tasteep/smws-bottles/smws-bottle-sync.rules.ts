/**
 * How a scrape run changes availability. Pure, so every rule is unit-tested
 * without a browser or a database.
 *
 * The SMWS listing is flaky (empty pages, items shifting between pages while
 * we paginate), so one run is never enough to declare a bottle gone:
 *  - a run is *trusted* only when the listing completed and is not
 *    suspiciously short compared with what we currently consider available;
 *  - a bottle the listing shows is always marked seen (positive evidence is
 *    safe to apply even from an untrusted run);
 *  - an available bottle missing from a trusted run gets a miss, and is
 *    delisted only after `missesBeforeDelist` trusted misses in a row;
 *  - before that, its own page is checked (`applyStockChecks`): in stock
 *    means the listing skipped it (no miss), out of stock means it is gone
 *    (delisted at once), unreadable leaves the miss rule to decide.
 */

export interface SyncRules {
  /** Trusted runs in a row a bottle must miss before it is delisted. */
  missesBeforeDelist: number;
  /** A listing shorter than this share of the available bottles is not trusted. */
  minListedRatio: number;
}

export const DEFAULT_SYNC_RULES: SyncRules = {
  missesBeforeDelist: 2,
  minListedRatio: 0.8,
};

export interface KnownBottle {
  code: string;
  url: string;
  delistedAt: Date | null;
  consecutiveMisses: number;
}

export interface SyncPlan {
  trusted: boolean;
  /** Why the run is not trusted; `null` when it is. */
  untrustedReason: string | null;
  /** Listed bottles we already know: mark seen, reset misses, clear `delisted_at`. */
  seen: string[];
  /** Of `seen`, the ones that were delisted. */
  relisted: string[];
  /** Available bottles that missed this trusted run but stay available for now, with their new miss count. */
  missed: { code: string; misses: number }[];
  /** Available bottles that reached the threshold this run. */
  delisted: string[];
  /** Listed URLs no known bottle has: their detail pages need scraping. */
  unknownUrls: string[];
  /** Of `seen`, the bottles missing from the listing but confirmed in stock on their own page. */
  confirmed: string[];
}

export function planSync(
  known: KnownBottle[],
  listedUrls: Iterable<string>,
  complete: boolean,
  rules: SyncRules = DEFAULT_SYNC_RULES,
): SyncPlan {
  const listed = new Set(listedUrls);
  const available = known.filter((b) => !b.delistedAt);

  let untrustedReason: string | null = null;
  if (!complete) {
    untrustedReason = 'Listing did not complete (a page kept failing).';
  } else if (
    available.length > 0 &&
    listed.size < Math.ceil(available.length * rules.minListedRatio)
  ) {
    untrustedReason = `Listing returned ${listed.size} bottles for ${available.length} currently available (below ${Math.round(rules.minListedRatio * 100)}%).`;
  }
  const trusted = untrustedReason === null;

  const knownUrls = new Set<string>();
  const seen: string[] = [];
  const relisted: string[] = [];
  const missed: { code: string; misses: number }[] = [];
  const delisted: string[] = [];

  for (const bottle of known) {
    knownUrls.add(bottle.url);
    if (listed.has(bottle.url)) {
      seen.push(bottle.code);
      if (bottle.delistedAt) relisted.push(bottle.code);
    } else if (trusted && !bottle.delistedAt) {
      const misses = bottle.consecutiveMisses + 1;
      if (misses >= rules.missesBeforeDelist) delisted.push(bottle.code);
      else missed.push({ code: bottle.code, misses });
    }
  }

  return {
    trusted,
    untrustedReason,
    seen,
    relisted,
    missed,
    delisted,
    unknownUrls: [...listed].filter((url) => !knownUrls.has(url)),
    confirmed: [],
  };
}

/** Bottles whose page should be checked before a miss counts: every miss and delist of a trusted run. */
export function stockCheckCandidates(plan: SyncPlan): string[] {
  return [...plan.missed.map((m) => m.code), ...plan.delisted];
}

/** `true` in stock, `false` out of stock, `null` page unreadable or without stock data. */
export type StockCheck = boolean | null;

/**
 * Folds the page checks into the plan. Missing from `checks` is the same as
 * `null`: the miss rule decides, as before.
 */
export function applyStockChecks(
  plan: SyncPlan,
  checks: Map<string, StockCheck>,
): SyncPlan {
  const state = (code: string) => checks.get(code) ?? null;
  const confirmed = stockCheckCandidates(plan).filter(
    (code) => state(code) === true,
  );
  return {
    ...plan,
    seen: [...plan.seen, ...confirmed],
    confirmed: [...plan.confirmed, ...confirmed],
    missed: plan.missed.filter((m) => state(m.code) === null),
    delisted: [
      ...plan.delisted.filter((code) => state(code) !== true),
      ...plan.missed.filter((m) => state(m.code) === false).map((m) => m.code),
    ],
  };
}
