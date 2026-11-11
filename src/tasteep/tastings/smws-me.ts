import type { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import type { TasteepTasting } from '../entities/tasteep-tasting.entity';
import {
  SmwsBottleJson,
  toSmwsBottleJson,
} from '../smws-bottles/smws-bottle.mapper';
import { fold, profileKey } from '../smws-bottles/smws-bottle.search';

/** `GET /tasteep/smws/me`: the user's SMWS progress, from tastings linked to a bottle. */
export interface SmwsMeJson {
  /** Distinct bottles the user's tastings are linked to. */
  linked_casks: number;
  linked_tastings: number;
  distilleries: {
    tasted: number;
    /** Every code in the codes list: the size of the app's grid. */
    total: number;
    /** Distillery codes tasted, in the codes list's order. */
    codes: string[];
  };
  /** Up to 5 bottles, best score first (the best tasting of each). */
  best: {
    bottle: SmwsBottleJson;
    score: number;
    tasting_id: string;
    date_tasted: string | null;
  }[];
  by_profile: ScoreGroup<'profile'>[];
  by_cask: ScoreGroup<'cask'>[];
  untried: {
    /** Regions where some codes are still untasted, fewest tasted first (10 at most). */
    regions: {
      region_id: string;
      name: string;
      tasted: number;
      total: number;
    }[];
    /** Codes-list categories with nothing tasted yet, largest first. */
    categories: { category: string; tasted: number; total: number }[];
  };
}

type ScoreGroup<K extends string> = Record<K, string> & {
  avg_score: number;
  count: number;
};

export const CASK_FAMILIES = [
  'px',
  'oloroso',
  'sherry',
  'port',
  'wine',
  'rum',
  'virgin_oak',
  'bourbon',
  'other',
] as const;
export type CaskFamily = (typeof CASK_FAMILIES)[number];

/**
 * The cask family a free-text cask type belongs to. The first rule that
 * matches wins, so a finishing cask beats the bourbon wood it started in:
 * `1st fill ex-bourbon hogshead & refill red wine barrique` → `wine`.
 */
const CASK_RULES: [CaskFamily, RegExp][] = [
  ['px', /\bpx\b|pedro xim/],
  ['oloroso', /oloroso/],
  ['sherry', /sherry|amontillado|\bfino\b|manzanilla|palo cortado|moscatel/],
  ['port', /\bport\b|tawny/],
  [
    'wine',
    /wine|sauternes|tokaj|madeira|marsala|rioja|bordeaux|burgundy|\bstr\b/,
  ],
  ['rum', /\brum\b/],
  // New or re-made oak: virgin, heavy-toast (HTMC) and numbered-char casks.
  ['virgin_oak', /virgin|new (?:american |french |charred )?oak|htmc|#\d char/],
  ['bourbon', /bourbon/],
];

export function caskFamily(caskType: string): CaskFamily {
  const text = fold(caskType);
  return CASK_RULES.find(([, re]) => re.test(text))?.[0] ?? 'other';
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const MAX_BEST = 5;
const MAX_UNTRIED_REGIONS = 10;

function averages<K extends string>(
  name: K,
  entries: { key: string; label: string; score: number }[],
): ScoreGroup<K>[] {
  const groups = new Map<string, { label: string; sum: number; n: number }>();
  for (const e of entries) {
    const g = groups.get(e.key) ?? { label: e.label, sum: 0, n: 0 };
    g.sum += e.score;
    g.n += 1;
    groups.set(e.key, g);
  }
  return [...groups.values()]
    .map(
      (g) =>
        ({
          [name]: g.label,
          avg_score: round1(g.sum / g.n),
          count: g.n,
        }) as ScoreGroup<K>,
    )
    .sort((a, b) => b.avg_score - a.avg_score || b.count - a.count);
}

const time = (d: Date | null) => (d ? new Date(d).getTime() : 0);

/**
 * Builds the user's SMWS progress. `tastings` are the user's tastings with
 * `smwsBottle` (and its `smwsCode`) loaded; unlinked ones are ignored.
 * `codes` is the codes list in display order; `regionNames` maps region ids
 * to names.
 */
export function buildSmwsMe(
  tastings: TasteepTasting[],
  codes: Pick<TasteepSmwsCode, 'code' | 'category' | 'regionId'>[],
  regionNames: Map<string, string>,
): SmwsMeJson {
  const linked = tastings.filter((t) => t.smwsBottle);
  const scored = linked.filter((t) => t.score !== null);

  const tastedSet = new Set(
    linked
      .map((t) => t.smwsBottle?.distilleryCode)
      .filter((c): c is string => !!c),
  );
  const tastedCodes = codes
    .map((c) => c.code)
    .filter((code) => tastedSet.has(code));

  // Best tasting of each bottle, then the best bottles.
  const bestBySku = new Map<string, TasteepTasting>();
  for (const t of scored) {
    const sku = t.smwsBottle!.sku;
    const seen = bestBySku.get(sku);
    if (
      !seen ||
      t.score! > seen.score! ||
      (t.score === seen.score && time(t.dateTasted) > time(seen.dateTasted))
    ) {
      bestBySku.set(sku, t);
    }
  }
  const best = [...bestBySku.values()]
    .sort(
      (a, b) => b.score! - a.score! || time(b.dateTasted) - time(a.dateTasted),
    )
    .slice(0, MAX_BEST)
    .map((t) => ({
      bottle: toSmwsBottleJson(t.smwsBottle!),
      score: t.score!,
      tasting_id: t.id,
      date_tasted: t.dateTasted ? new Date(t.dateTasted).toISOString() : null,
    }));

  const by_profile = averages(
    'profile',
    scored
      .filter((t) => t.smwsBottle!.profile)
      .map((t) => ({
        key: profileKey(t.smwsBottle!.profile!),
        label: t.smwsBottle!.profile!,
        score: t.score!,
      })),
  );
  const by_cask = averages(
    'cask',
    scored
      .filter((t) => t.smwsBottle!.caskType)
      .map((t) => {
        const family = caskFamily(t.smwsBottle!.caskType!);
        return { key: family, label: family, score: t.score! };
      }),
  );

  const byRegion = new Map<string, { tasted: number; total: number }>();
  const byCategory = new Map<string, { tasted: number; total: number }>();
  for (const c of codes) {
    const tasted = tastedSet.has(c.code) ? 1 : 0;
    if (c.regionId) {
      const r = byRegion.get(c.regionId) ?? { tasted: 0, total: 0 };
      r.tasted += tasted;
      r.total += 1;
      byRegion.set(c.regionId, r);
    }
    const g = byCategory.get(c.category) ?? { tasted: 0, total: 0 };
    g.tasted += tasted;
    g.total += 1;
    byCategory.set(c.category, g);
  }

  return {
    linked_casks: new Set(linked.map((t) => t.smwsBottle!.sku)).size,
    linked_tastings: linked.length,
    distilleries: {
      tasted: tastedCodes.length,
      total: codes.length,
      codes: tastedCodes,
    },
    best,
    by_profile,
    by_cask,
    untried: {
      regions: [...byRegion.entries()]
        .filter(([, r]) => r.tasted < r.total)
        .map(([id, r]) => ({
          region_id: id,
          name: regionNames.get(id) ?? id,
          ...r,
        }))
        .sort((a, b) => a.tasted - b.tasted || b.total - a.total)
        .slice(0, MAX_UNTRIED_REGIONS),
      categories: [...byCategory.entries()]
        .filter(([, g]) => g.tasted === 0)
        .map(([category, g]) => ({ category, ...g }))
        .sort((a, b) => b.total - a.total),
    },
  };
}
