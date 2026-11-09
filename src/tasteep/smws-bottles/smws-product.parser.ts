import { load } from 'cheerio';

/**
 * Raw content of one smws.eu product page, read from plain HTML (no browser).
 * Every value is as the shop gives it; `smws-catalog.rules.ts` turns it into
 * bottle fields. Sources, most structured first:
 *  - `window.productJsonData` (script#productScript): product id, sku, title,
 *    url, categories, price, stock level, and `custom_fields` — the shop's own
 *    spec (`Whisky Cask Code`, `ABV`, `Age`, `Date Distilled`, `Cask Type`,
 *    `Region`, `Society Code`, `Release Date`…)
 *  - `BCData.product_attributes`: the `instock` flag and sku
 *  - the visible info list (`.productView-info`): `ABV`, `Age`,
 *    `DISTILLED DATE`, `CASK`, `PROFILE`, `REGION` — the fields the
 *    Playwright scraper used to read, in the same format
 */
export interface ParsedProductPage {
  productId: number | null;
  sku: string | null;
  title: string | null;
  url: string | null;
  categories: string[];
  price: {
    formatted: string | null;
    value: number | null;
    currency: string | null;
  };
  /** `BCData` flag, else derived from `out_of_stock` / `stock_level`; `null` when the page says nothing. */
  inStock: boolean | null;
  stockLevel: number | null;
  /** `custom_fields`, keyed by name as given. */
  custom: Record<string, string>;
  /** Visible info list, keyed by upper-cased label (`ABV`, `AGE`, `CASK`…). */
  info: Record<string, string>;
  /** Text of `.productView-details .caskNo`, e.g. `1.309` or `SOCIETY NO. Batch 40`. */
  caskNoText: string | null;
  /** `data-flavour-profile` of the main `.productView` (the value the shop's script shows as PROFILE). */
  flavourProfileAttr: string | null;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** `window.productJsonData = JSON.parse("…")`: the argument is a JSON string literal holding JSON. */
function readProductJson(script: string): Json | null {
  const m = script.match(
    /productJsonData\s*=\s*JSON\.parse\(\s*("(?:[^"\\]|\\.)*")\s*\)/s,
  );
  if (!m) return null;
  try {
    const parsed: unknown = JSON.parse(JSON.parse(m[1]) as string);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readBcData(script: string): Json | null {
  const m = script.match(/var\s+BCData\s*=\s*(\{.*?\});\s*(?:\n|$|<)/s);
  if (!m) return null;
  try {
    const parsed: unknown = JSON.parse(m[1]);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `null` when the HTML is not a product page (no product data at all). */
export function parseProductPage(html: string): ParsedProductPage | null {
  const $ = load(html);

  let productJson: Json | null = null;
  let bcData: Json | null = null;
  $('script').each((_, el) => {
    const text = $(el).text();
    if (!productJson && text.includes('productJsonData')) {
      productJson = readProductJson(text);
    }
    if (!bcData && text.includes('BCData')) bcData = readBcData(text);
  });
  const pj = productJson as Json | null;
  const details = pj && isObject(pj.productDetails) ? pj.productDetails : null;
  const attributes =
    bcData && isObject((bcData as Json).product_attributes)
      ? ((bcData as Json).product_attributes as Json)
      : null;

  const scope = $('.productView-details').first();
  const infoRoot = scope.find('.productView-info').first().length
    ? scope.find('.productView-info').first()
    : $('.productView-info').first();
  const info: Record<string, string> = {};
  infoRoot.find('li').each((_, li) => {
    const name = $(li)
      .find('.productView-info-name')
      .text()
      .trim()
      .toUpperCase();
    const value = $(li).find('.productView-info-value').text().trim();
    if (name && !(name in info)) info[name] = value;
  });

  const htmlTitle = (
    scope.find('.productView-title').first().text() ||
    $('.productView-title').first().text()
  ).trim();
  const caskNoText = scope
    .find('.caskNo')
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .trim();

  const flavourProfileAttr =
    $('.productView[data-flavour-profile]')
      .first()
      .attr('data-flavour-profile')
      ?.trim() || null;

  if (!pj && !attributes && !htmlTitle) return null;

  const custom: Record<string, string> = {};
  const fields = details?.custom_fields;
  if (Array.isArray(fields)) {
    for (const f of fields) {
      if (!isObject(f)) continue;
      const name = str(f.name);
      const value = str(f.value);
      if (name && value !== null && !(name in custom)) custom[name] = value;
    }
  }

  const categories = (
    Array.isArray(pj?.ps_product_category)
      ? pj.ps_product_category
      : Array.isArray(details?.category)
        ? details.category
        : []
  ).filter((c): c is string => typeof c === 'string');

  const priceSource =
    (pj && isObject(pj.ps_product_price) ? pj.ps_product_price : null) ??
    (details && isObject(details.price) ? details.price : null);
  const withTax =
    priceSource && isObject(priceSource.with_tax) ? priceSource.with_tax : null;

  const stockLevel = num(details?.stock_level ?? attributes?.stock);
  let inStock: boolean | null =
    typeof attributes?.instock === 'boolean' ? attributes.instock : null;
  if (inStock === null && details) {
    if (details.out_of_stock === true) inStock = false;
    else if (stockLevel !== null) inStock = stockLevel > 0;
  }

  return {
    productId: num(details?.id ?? pj?.productId ?? pj?.ps_product_id),
    sku: str(details?.sku) ?? str(attributes?.sku),
    title: str(details?.title) ?? (htmlTitle || null),
    url: str(details?.url) ?? str(pj?.ps_product_url),
    categories,
    price: {
      formatted: str(withTax?.formatted),
      value: num(withTax?.value),
      currency: str(withTax?.currency),
    },
    inStock,
    stockLevel,
    custom,
    info,
    caskNoText: caskNoText || null,
    flavourProfileAttr,
  };
}

/** Product URLs of a sitemap `<urlset>`, or the child sitemaps of a `<sitemapindex>`. */
export function parseSitemap(xml: string): {
  sitemaps: string[];
  urls: string[];
} {
  const $ = load(xml, { xml: true });
  const locs = (selector: string) =>
    $(selector)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
  return {
    sitemaps: locs('sitemapindex > sitemap > loc'),
    urls: locs('urlset > url > loc'),
  };
}
