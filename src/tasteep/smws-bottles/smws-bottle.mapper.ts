import { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import { TasteepSmwsScrapeRun } from '../entities/tasteep-smws-scrape-run.entity';

/** One entry of `GET /tasteep/smws-bottles`. */
export interface SmwsBottleJson {
  code: string;
  distillery_code: string;
  cask_no: string;
  name: string;
  url: string;
  /** From `tasteep_smws_codes`; `null` when the code is not in the reference list. */
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
  available: boolean;
  first_seen_at: string;
  last_seen_at: string;
  delisted_at: string | null;
}

export interface SmwsBottlePage {
  total: number;
  items: SmwsBottleJson[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toSmwsBottleJson(b: TasteepSmwsBottle): SmwsBottleJson {
  return {
    code: b.code,
    distillery_code: b.distilleryCode,
    cask_no: b.caskNo,
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
    available: b.delistedAt === null,
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
  pages: number | null;
  listed: number | null;
  added: number | null;
  relisted: number | null;
  missed: number | null;
  delisted: number | null;
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
    pages: r.pages,
    listed: r.listed,
    added: r.added,
    relisted: r.relisted,
    missed: r.missed,
    delisted: r.delisted,
    note: r.note,
    error: r.error,
  };
}
