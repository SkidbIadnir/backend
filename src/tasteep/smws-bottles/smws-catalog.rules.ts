import type { SmwsBottleKind } from '../entities/tasteep-smws-bottle.entity';
import {
  parseAbv,
  parseDistilledDate,
  parsePrice,
  repairMojibake,
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

/**
 * Version of these rules. Bump it when a change should reach bottles already
 * stored: every bottle page read with an older version is read again on the
 * next run.
 */
export const CATALOG_RULES_VERSION = 2;

/** Bottle fields read from one page; `regionId` is resolved later by the sync service. */
export interface BottleRead {
  sku: string;
  productId: number | null;
  url: string;
  kind: SmwsBottleKind;
  /**
   * The kind comes from the page's cask code text (a single cask code, an
   * `SM` code, two codes). Otherwise it was guessed from the other fields,
   * and does not demote a stored single cask.
   */
  kindFromCode: boolean;
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

/** First non-empty value, with the shop's double-encoded characters repaired. */
const first = (...values: (string | null | undefined)[]): string | null => {
  for (const v of values) {
    const t = textOrNull(v);
    if (t) return repairMojibake(t);
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

/**
 * The label a blend is sold under: `batch 42` → `Batch 42`, and any other
 * text as written (`Distillery 68 Rare Release`, `BAT.14`, `SM0.001`).
 */
function batchLabel(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const text = first(t?.replace(/^\s*(?:cask|society)\s*no\.?\s*/i, ''));
    if (!text) continue;
    const m = text.match(/^batch\s*[#:]?\s*([A-Za-z0-9-]+)$/i);
    return m ? `Batch ${m[1]}` : text;
  }
  return null;
}

/**
 * Cask code spelled by a single cask's SKU (`005138EU0700610` → `5.138`,
 * `0G8022GX0700632` → `G8.22`), for the few pages that show no code. It
 * matches the page's code on 2,215 of 2,219 stored single casks.
 */
export function codeFromSku(sku: string | null): string | null {
  const m = sku?.match(/^([0-9A-Z]{3})(\d{3})[A-Z]{2}\d/);
  if (!m) return null;
  const prefix = m[1].replace(/^0+/, '');
  if (!/^(\d+|[A-Z]{1,2}\d+)$/.test(prefix) || prefix.startsWith('SM')) {
    return null;
  }
  const cask = parseInt(m[2], 10);
  return cask ? `${prefix}.${cask}` : null;
}

/** Spirit types that are whisky (`Malt Whisky`, `Single Malt Irish Whiskey`, `Blended Grain`). */
const WHISKY = /whisk|malt|grain|blend/i;

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
  const rawAbv = parseAbv(first(info['ABV'], custom['ABV']));
  if (rawAbv === null) return null;
  // A few pages give the ABV as a fraction (`0.556%` for 55.6%).
  const abv = rawAbv < 1 ? Math.round(rawAbv * 1000) / 10 : rawAbv;

  const sku =
    page.sku ??
    (page.productId !== null ? `product:${page.productId}` : `url:${url}`);
  const ageNumber = textOrNull(custom['Age']);
  const age = first(
    info['AGE'],
    ageNumber && /^\d+$/.test(ageNumber) ? `${ageNumber} years` : ageNumber,
  );
  const codeText = first(custom['Whisky Cask Code'], page.caskNoText);
  const spirit = first(custom['Spirit Type']);
  const whisky = !spirit || WHISKY.test(spirit);

  // Kind: two casks in one product (`24.182 & 19.102`, `16 & 21 years`) is a
  // pack; an `SM` code is a blend; any other cask code is a single cask.
  let kind: SmwsBottleKind;
  let kindFromCode = true;
  let code =
    splitSmwsCode(custom['Whisky Cask Code']) ?? splitSmwsCode(page.caskNoText);
  if (/&/.test(codeText ?? '') || /&/.test(age ?? '')) {
    kind = 'other';
    code = null;
  } else if (code?.distilleryCode.startsWith('SM')) {
    kind = 'blend';
    code = null;
  } else if (code) {
    kind = 'single_cask';
  } else {
    kindFromCode = false;
    const batch = batchLabel(
      custom['Society Code'],
      custom['Whisky Cask Code'],
    );
    // A page sold under a batch label is a blend whatever its SKU spells.
    code = whisky && !batch ? splitSmwsCode(codeFromSku(page.sku)) : null;
    kind = code
      ? 'single_cask'
      : whisky && (age || batch || /blend/i.test(spirit ?? ''))
        ? 'blend'
        : 'other';
  }

  const price = parsePrice(page.price.formatted);
  const priceAmount = page.price.value ?? price.amount;
  // A €0.00 price is a members' gift or parcel item, not a price.
  const priced = priceAmount !== 0;

  return {
    sku,
    productId: page.productId,
    url,
    kind,
    kindFromCode,
    code: code?.code ?? null,
    distilleryCode: code?.distilleryCode ?? null,
    caskNo: code?.caskNo ?? null,
    batch:
      kind === 'single_cask'
        ? null
        : batchLabel(
            custom['Society Code'],
            custom['Whisky Cask Code'],
            page.caskNoText,
          ),
    name: first(page.title, custom['Long Title']),
    priceText: priced ? page.price.formatted : null,
    priceAmount: priced ? priceAmount : null,
    priceCurrency: priced ? (page.price.currency ?? price.currency) : null,
    abv,
    age,
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
export type StoredBottle = Omit<
  BottleRead,
  'inStock' | 'name' | 'kindFromCode'
> & {
  name: string;
  inStock: boolean;
  regionId: string | null;
};

/**
 * Combines a new read with the stored row. Never loses data: a field the
 * read lacks keeps its stored value, and categories are the union of both
 * (a sold-out bottle moves to `Bottle Archive` and loses its other
 * categories). Price, stock and availability take the new read when it has
 * them.
 *
 * Kind, code and batch follow the read, so a reclassified product is fixed
 * on its next read. The one exception: a stored single cask is kept as one
 * when the read shows no cask code at all, since that is a page missing its
 * code rather than evidence of another kind.
 */
export function mergeBottle(
  stored: StoredBottle | null,
  read: BottleRead,
  regionId: string | null,
): StoredBottle {
  const keep = <K extends keyof StoredBottle>(key: K): StoredBottle[K] =>
    (read[key as keyof BottleRead] ?? stored?.[key] ?? null) as StoredBottle[K];

  const keepIdentity =
    stored?.kind === 'single_cask' &&
    read.kind !== 'single_cask' &&
    !read.kindFromCode;
  const identity = keepIdentity
    ? stored
    : {
        kind: read.kind,
        code: read.code,
        distilleryCode: read.distilleryCode,
        caskNo: read.caskNo,
        batch:
          read.batch ??
          (stored?.kind === read.kind && read.kind !== 'single_cask'
            ? stored.batch
            : null),
      };
  // Price fields move together; a stored €0.00 is dropped like a read one.
  const price =
    read.priceAmount !== null
      ? read
      : stored?.priceAmount
        ? stored
        : { priceText: null, priceAmount: null, priceCurrency: null };
  const inStock = read.inStock ?? stored?.inStock ?? false;
  return {
    sku: stored?.sku ?? read.sku,
    productId: keep('productId'),
    url: read.url,
    kind: identity.kind,
    code: identity.code,
    distilleryCode: identity.distilleryCode,
    caskNo: identity.caskNo,
    batch: identity.batch,
    name: read.name ?? stored?.name ?? slugName(read.url),
    priceText: price.priceText,
    priceAmount: price.priceAmount,
    priceCurrency: price.priceCurrency,
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
