import { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import { TasteepSmwsScrapeRun } from '../entities/tasteep-smws-scrape-run.entity';

/** One entry of `GET /tasteep/smws-bottles`. */
export interface SmwsBottleJson {
  /** The shop's SKU: the bottle's stable id. */
  sku: string;
  /** `single_cask` or `blend`. */
  kind: string;
  /** `1.309`; `null` for blends. */
  code: string | null;
  distillery_code: string | null;
  cask_no: string | null;
  /** Blends: `Batch 40`. */
  batch: string | null;
  name: string;
  url: string;
  /** From `tasteep_smws_codes`; `null` for blends or a code the list lacks. */
  distillery_name: string | null;
  category: string | null;
  region_text: string | null;
  /** Id from `GET /tasteep/regions` (country or subregion). */
  region_id: string | null;
  price_text: string | null;
  price_amount: number | null;
  price_currency: string | null;
  abv: number | null;
  age: string | null;
  cask_type: string | null;
  /** `YYYY-MM-DD`. */
  distilled_date: string | null;
  profile: string | null;
  /** The shop's release date. */
  released_at: string | null;
  available: boolean;
  /** Units left at the last check, when shown. */
  stock: number | null;
  first_seen_at: string;
  last_seen_at: string;
  /** When we saw it sell out; `null` if available or already sold out when first seen. */
  delisted_at: string | null;
}

export interface SmwsBottlePage {
  total: number;
  items: SmwsBottleJson[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toSmwsBottleJson(b: TasteepSmwsBottle): SmwsBottleJson {
  return {
    sku: b.sku,
    kind: b.kind,
    code: b.code,
    distillery_code: b.distilleryCode,
    cask_no: b.caskNo,
    batch: b.batch,
    name: b.name,
    url: b.url,
    distillery_name: b.smwsCode?.distilleryName ?? null,
    category: b.smwsCode?.category ?? null,
    region_text: b.regionText,
    region_id: b.regionId,
    price_text: b.priceText,
    price_amount: b.priceAmount,
    price_currency: b.priceCurrency,
    abv: b.abv,
    age: b.age,
    cask_type: b.caskType,
    distilled_date: b.distilledDate,
    profile: b.profile,
    released_at: iso(b.releasedAt),
    available: b.inStock,
    stock: b.stock,
    first_seen_at: b.firstSeenAt.toISOString(),
    last_seen_at: b.lastSeenAt.toISOString(),
    delisted_at: iso(b.delistedAt),
  };
}

/** Admin view of one scraper run. */
export interface SmwsScrapeRunJson {
  id: number;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  sitemap_urls: number | null;
  discovered: number | null;
  added: number | null;
  checked: number | null;
  relisted: number | null;
  delisted: number | null;
  failed: number | null;
  note: string | null;
  error: string | null;
}

export function toSmwsScrapeRunJson(
  r: TasteepSmwsScrapeRun,
): SmwsScrapeRunJson {
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    started_at: r.startedAt.toISOString(),
    finished_at: iso(r.finishedAt),
    sitemap_urls: r.sitemapUrls,
    discovered: r.discovered,
    added: r.added,
    checked: r.checked,
    relisted: r.relisted,
    delisted: r.delisted,
    failed: r.failed,
    note: r.note,
    error: r.error,
  };
}
