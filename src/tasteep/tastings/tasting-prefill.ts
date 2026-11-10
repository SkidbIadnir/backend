import type { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import type { TastingCategory } from '../entities/tasteep-tasting.entity';
import {
  SmwsBottleJson,
  toSmwsBottleJson,
} from '../smws-bottles/smws-bottle.mapper';
import type { TastingJson } from './tasting.mapper';

/** Tasting fields a catalog bottle fills in; the user edits them before saving. */
export type TastingPrefillFields = Pick<
  TastingJson,
  | 'name'
  | 'category'
  | 'distillery'
  | 'region'
  | 'region_id'
  | 'abv'
  | 'price'
  | 'age_statement'
  | 'cask_type'
  | 'smws_sku'
>;

/** One of the user's own tastings of the same bottle. */
export interface PreviousTastingJson {
  id: string;
  name: string;
  date_tasted: string | null;
  score: number | null;
}

/** `GET /tasteep/tastings/prefill/:bottle`. */
export interface TastingPrefillJson {
  /** Fields for the new tasting form, keyed like `Tasting`. */
  tasting: TastingPrefillFields;
  /** The bottle as `GET /tasteep/smws-bottles/:id` returns it, for display. */
  bottle: SmwsBottleJson;
  /** The user's earlier tastings of this bottle, newest first. */
  previous_tastings: PreviousTastingJson[];
}

/** `tasteep_smws_codes` categories that are whisky. */
const WHISKY_CATEGORIES = /whisk|malt|grain|bourbon|rye|corn/i;

/**
 * Tasting category of a bottle: from its distillery code's category, else
 * from the shop's category paths (`All Rum/…`), else whisky for blends.
 */
export function tastingCategory(b: TasteepSmwsBottle): TastingCategory {
  const code = b.smwsCode?.category;
  if (code) {
    if (WHISKY_CATEGORIES.test(code)) return 'whisky';
    if (/rum/i.test(code)) return 'rum';
    if (/tequila|mezcal|agave/i.test(code)) return 'agave';
    return 'other';
  }
  const paths = b.categories.join(' ');
  if (/\brum\b/i.test(paths)) return 'rum';
  if (/tequila|mezcal|agave/i.test(paths)) return 'agave';
  if (b.kind === 'blend' || /whisk/i.test(paths)) return 'whisky';
  return 'other';
}

/** `14 years` → `14` (the journal's format); other texts as they are. */
export function ageStatement(age: string | null): string | null {
  if (!age) return null;
  return age.match(/^(\d+) years?$/i)?.[1] ?? age;
}

/**
 * The name the journal shows: `29.311 Diesel à la crème` for a single cask
 * (the code is how SMWS bottles are known), the shop's name otherwise.
 */
export function prefillName(b: TasteepSmwsBottle): string {
  return b.kind === 'single_cask' && b.code ? `${b.code} ${b.name}` : b.name;
}

export function toTastingPrefill(
  b: TasteepSmwsBottle,
  previous: PreviousTastingJson[],
): TastingPrefillJson {
  return {
    tasting: {
      name: prefillName(b),
      category: tastingCategory(b),
      distillery: b.smwsCode?.distilleryName ?? null,
      region: b.regionText,
      region_id: b.regionId,
      abv: b.abv,
      price: b.priceAmount,
      age_statement: ageStatement(b.age),
      cask_type: b.caskType,
      smws_sku: b.sku,
    },
    bottle: toSmwsBottleJson(b),
    previous_tastings: previous,
  };
}

/**
 * Cask code a journal name starts with: `29.311 Diesel à la crème`,
 * `SMWS 1.309`. Lets tastings written without the picker (an older app, or
 * typed offline) still link to their bottle.
 */
export function codeInName(name: string): string | null {
  const m = name.match(
    /^\s*(?:smws\s+)?([a-z]{0,3}\d{1,3}\.\d{1,4})(?=\s|$|[,:;-])/i,
  );
  return m ? m[1].toUpperCase() : null;
}
