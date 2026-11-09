import type { SmwsBottleKind } from '../entities/tasteep-smws-bottle.entity';
import {
  parseAbv,
  parseDistilledDate,
  parsePrice,
  splitSmwsCode,
  textOrNull,
} from './smws-bottle.parse';
import type { ParsedProductPage } from './smws-product.parser';

/**
 * Pure rules from a parsed product page to bottle fields, and from a new
 * read to the stored row. Each field reads the visible info list first (the
 * source and format the Playwright scraper used), then the shop's
 * `custom_fields`, so a value missing from one is taken from the other.
 */

/** Bottle fields read from one page; `regionId` is resolved later by the sync service. */
export interface BottleRead {
  sku: string;
  productId: number | null;
  url: string;
  kind: SmwsBottleKind;
  code: string | null;
  distilleryCode: string | null;
  caskNo: string | null;
  batch: string | null;
  /** Page title; `null` when the page has none. */
  name: string | null;
  priceText: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  abv: number | null;
  age: string | null;
  caskType: string | null;
  distilledDate: string | null;
  profile: string | null;
  regionText: string | null;
  categories: string[];
  releasedAt: Date | null;
  /** `null` when the page carries no stock data. */
  inStock: boolean | null;
  stock: number | null;
}

const first = (...values: (string | null | undefined)[]): string | null => {
  for (const v of values) {
    const t = textOrNull(v);
    if (t) return t;
  }
  return null;
};

/** `New Flavour Profiles/Dried Fruits & Spices` → `Dried Fruits & Spices` (new taxonomy first). */
export function profileFromCategories(categories: string[]): string | null {
  for (const family of ['New Flavour Profiles', 'Legacy Flavour Profiles']) {
    for (const c of categories) {
      const m = c.match(new RegExp(`(?:^|/)${family}/([^/]+)$`));
      if (m?.[1].trim()) return m[1].trim();
    }
  }
  return null;
}

/** `2026-11-06 09:00:00` → that instant read as UTC; `null` when unparseable. */
export function parseReleaseDate(text: string | null | undefined): Date | null {
  const m = text
    ?.trim()
    .match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/);
  if (!m) return null;
  const date = new Date(`${m[1]}T${m[2] ?? '00:00:00'}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `Batch 40` from any of the given texts. */
function findBatch(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = t?.match(/\bbatch\s*[#:]?\s*([A-Za-z0-9-]+)/i);
    if (m) return `Batch ${m[1]}`;
  }
  return null;
}

/** Last path segment of a product URL, as a name of last resort. */
const slugName = (url: string) =>
  decodeURIComponent(url.replace(/\/+$/, '').split('/').pop() ?? url).replace(
    /-/g,
    ' ',
  );

/**
 * Bottle fields of a product page, or `null` when the product is not a drink
 * (no ABV anywhere: gift cards, glassware, packs…).
 */
export function readBottle(
  page: ParsedProductPage,
  url: string,
): BottleRead | null {
  const { info, custom } = page;
  const abv = parseAbv(first(info['ABV'], custom['ABV']));
  if (abv === null) return null;

  const code =
    splitSmwsCode(custom['Whisky Cask Code']) ?? splitSmwsCode(page.caskNoText);
  const price = parsePrice(page.price.formatted);
  const ageNumber = textOrNull(custom['Age']);

  return {
    sku:
      page.sku ??
      (page.productId !== null ? `product:${page.productId}` : `url:${url}`),
    productId: page.productId,
    url,
    kind: code ? 'single_cask' : 'blend',
    code: code?.code ?? null,
    distilleryCode: code?.distilleryCode ?? null,
    caskNo: code?.caskNo ?? null,
    batch: code
      ? null
      : findBatch(
          custom['Society Code'],
          custom['Whisky Cask Code'],
          page.caskNoText,
        ),
    name: first(page.title),
    priceText: page.price.formatted,
    priceAmount: page.price.value ?? price.amount,
    priceCurrency: page.price.currency ?? price.currency,
    abv,
    age: first(
      info['AGE'],
      ageNumber && /^\d+$/.test(ageNumber) ? `${ageNumber} years` : ageNumber,
    ),
    caskType: first(info['CASK'], info['CASK TYPE'], custom['Cask Type']),
    distilledDate:
      parseDistilledDate(info['DISTILLED DATE']) ??
      parseDistilledDate(custom['Date Distilled']),
    profile:
      first(
        info['PROFILE'],
        page.flavourProfileAttr,
        custom['Flavour Profile'],
      ) ?? profileFromCategories(page.categories),
    regionText: first(info['REGION'], custom['Region']),
    categories: page.categories,
    releasedAt: parseReleaseDate(custom['Release Date']),
    inStock: page.inStock,
    stock: page.stockLevel,
  };
}

/** Stored fields a read may fill or refresh (everything but bookkeeping). */
export type StoredBottle = Omit<BottleRead, 'inStock' | 'name'> & {
  name: string;
  inStock: boolean;
  regionId: string | null;
};

/**
 * Combines a new read with the stored row. Never loses data: a field the
 * read lacks keeps its stored value, and categories are the union of both
 * (a sold-out bottle moves to `Bottle Archive` and loses its other
 * categories). Price, stock and availability take the new read when it has
 * them; `kind` follows the merged code.
 */
export function mergeBottle(
  stored: StoredBottle | null,
  read: BottleRead,
  regionId: string | null,
): StoredBottle {
  const keep = <K extends keyof StoredBottle>(key: K): StoredBottle[K] =>
    (read[key as keyof BottleRead] ?? stored?.[key] ?? null) as StoredBottle[K];

  const code = keep('code');
  const inStock = read.inStock ?? stored?.inStock ?? false;
  return {
    sku: stored?.sku ?? read.sku,
    productId: keep('productId'),
    url: read.url,
    kind: code ? 'single_cask' : 'blend',
    code,
    distilleryCode: keep('distilleryCode'),
    caskNo: keep('caskNo'),
    batch: code ? null : keep('batch'),
    name: read.name ?? stored?.name ?? slugName(read.url),
    priceText: keep('priceText'),
    priceAmount: keep('priceAmount'),
    priceCurrency: keep('priceCurrency'),
    abv: keep('abv'),
    age: keep('age'),
    caskType: keep('caskType'),
    distilledDate: keep('distilledDate'),
    profile: keep('profile'),
    regionText: keep('regionText'),
    regionId: regionId ?? stored?.regionId ?? null,
    categories: [
      ...new Set([...(stored?.categories ?? []), ...read.categories]),
    ],
    releasedAt: keep('releasedAt'),
    inStock,
    stock: read.stock ?? (inStock ? (stored?.stock ?? null) : 0),
  };
}

export type StockChange = 'relisted' | 'delisted' | null;

/** What a read changes in availability. A new bottle has no change: `delisted_at` stays null. */
export function stockChange(
  stored: { inStock: boolean } | null,
  merged: { inStock: boolean },
): StockChange {
  if (!stored || stored.inStock === merged.inStock) return null;
  return merged.inStock ? 'relisted' : 'delisted';
}
