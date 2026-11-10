import { BadRequestException } from '@nestjs/common';
import {
  SMWS_BOTTLE_KINDS,
  SmwsBottleKind,
} from '../entities/tasteep-smws-bottle.entity';

/**
 * Query string of `GET /tasteep/smws-bottles` and `/search`, as received.
 * Every value is optional; see `parseBottleSearch` for the rules.
 */
export interface BottleSearchQuery {
  q?: string;
  status?: string;
  kind?: string;
  category?: string;
  distillery_code?: string;
  region_id?: string;
  profile?: string;
  cask?: string;
  abv_min?: string;
  abv_max?: string;
  age_min?: string;
  age_max?: string;
  price_min?: string;
  price_max?: string;
  distilled_from?: string;
  distilled_to?: string;
  released_from?: string;
  released_to?: string;
  sort?: string;
  order?: string;
  limit?: string;
  offset?: string;
}

/** Query keys, for the controllers to copy from the request. */
export const BOTTLE_SEARCH_KEYS: (keyof BottleSearchQuery)[] = [
  'q',
  'status',
  'kind',
  'category',
  'distillery_code',
  'region_id',
  'profile',
  'cask',
  'abv_min',
  'abv_max',
  'age_min',
  'age_max',
  'price_min',
  'price_max',
  'distilled_from',
  'distilled_to',
  'released_from',
  'released_to',
  'sort',
  'order',
  'limit',
  'offset',
];

export const BOTTLE_STATUSES = ['available', 'delisted', 'all'] as const;
export type BottleStatus = (typeof BOTTLE_STATUSES)[number];

export const BOTTLE_SORTS = [
  'relevance',
  'released',
  'abv',
  'age',
  'price',
  'distilled',
] as const;
export type BottleSort = (typeof BOTTLE_SORTS)[number];

/** What the free text `q` turned out to be. */
export type TextQuery =
  /** A cask code or the start of one (`5.138`, `5.1`, `g8.22`, `5 138`): matches codes by prefix. */
  | { type: 'code'; code: string }
  /**
   * Words, each found somewhere in the bottle (code, name, batch, distillery,
   * region, cask, profile, age). `distilleryCode` is set when the whole text
   * could be a code prefix (`29`, `G1`): those bottles rank first.
   */
  | {
      type: 'words';
      words: string[];
      folded: string;
      distilleryCode: string | null;
    };

export interface BottleSearch {
  text: TextQuery | null;
  status: BottleStatus;
  kind: SmwsBottleKind | null;
  category: string | null;
  distilleryCode: string | null;
  regionId: string | null;
  /** Lowercase letters only, so `Deep, Rich & Dried Fruits` = `deep rich dried fruits`. */
  profileKey: string | null;
  /** Folded words, each found in the cask type (`sherry`, `1st fill oloroso`). */
  caskWords: string[];
  abv: Range;
  age: Range;
  price: Range;
  distilledYears: Range;
  releasedYears: Range;
  sort: BottleSort;
  order: 'ASC' | 'DESC';
  limit: number;
  offset: number;
}

export interface Range {
  min: number | null;
  max: number | null;
}

export interface SearchDefaults {
  status: BottleStatus;
  limit: number;
  maxLimit: number;
}

/** `GET /tasteep/smws-bottles`: the shop's current list. */
export const LIST_DEFAULTS: SearchDefaults = {
  status: 'available',
  limit: 50,
  maxLimit: 200,
};

/** `GET /tasteep/smws-bottles/search`: every bottle ever seen, a phone screen at a time. */
export const SEARCH_DEFAULTS: SearchDefaults = {
  status: 'all',
  limit: 20,
  maxLimit: 100,
};

const MAX_Q_LENGTH = 100;
const MAX_WORDS = 8;

/**
 * Lowercase without accents: `Ménage à mesquite` → `menage a mesquite`. The
 * SQL side folds with `FOLD_FROM`/`FOLD_TO` (Postgres has no `unaccent`
 * extension here), so both sides agree on the common Latin letters.
 */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** `translate()` arguments for the SQL fold of `fold()`. */
export const FOLD_FROM = 'àáâãäåèéêëìíîïòóôõöùúûüýÿçñ';
export const FOLD_TO = 'aaaaaaeeeeiiiiooooouuuuyycn';

/** `Deep, Rich & Dried Fruits` → `deeprichdriedfruits`. */
export const profileKey = (text: string) => fold(text).replace(/[^a-z]/g, '');

/** Escapes `%`, `_` and `\` for a `LIKE` pattern. */
export const likeEscape = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/**
 * A code as typed on a phone: `5.138`, `5,138`, `5-138`, `5 138`, `g8.22`,
 * `RW6.5`, or its start (`5.`, `5.1`).
 */
const CODE_TEXT = /^([a-z]{0,3})\s*(\d{1,3})\s*[.,\-\s]\s*(\d{0,4})$/i;
/** A distillery code alone: `29`, `G1`, `RW6`. */
const DISTILLERY_CODE_TEXT = /^[a-z]{0,3}\d{1,3}$/i;

export function parseTextQuery(q: string | undefined): TextQuery | null {
  const text = q?.trim().slice(0, MAX_Q_LENGTH) ?? '';
  if (!text) return null;
  const code = text.match(CODE_TEXT);
  if (code) {
    return {
      type: 'code',
      code: `${code[1].toUpperCase()}${code[2]}.${code[3]}`,
    };
  }
  const folded = fold(text).replace(/\s+/g, ' ');
  const words = [
    ...new Set(folded.split(' ').filter((w) => w.length > 0)),
  ].slice(0, MAX_WORDS);
  return {
    type: 'words',
    words,
    folded,
    distilleryCode: DISTILLERY_CODE_TEXT.test(text) ? text.toUpperCase() : null,
  };
}

function oneOf<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value === '') return fallback;
  const v = value.trim().toLowerCase() as T;
  if (!allowed.includes(v)) {
    throw new BadRequestException(
      `${name} must be one of ${allowed.join(', ')}.`,
    );
  }
  return v;
}

function intParam(
  name: string,
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new BadRequestException(
      `${name} must be an integer between 0 and ${max}.`,
    );
  }
  return n;
}

function numberParam(name: string, value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException(`${name} must be a positive number.`);
  }
  return n;
}

function range(
  query: BottleSearchQuery,
  min: keyof BottleSearchQuery,
  max: keyof BottleSearchQuery,
): Range {
  const r = {
    min: numberParam(min, query[min]),
    max: numberParam(max, query[max]),
  };
  if (r.min !== null && r.max !== null && r.min > r.max) {
    throw new BadRequestException(`${min} must not be above ${max}.`);
  }
  return r;
}

const textParam = (value: string | undefined) => value?.trim() || null;

/** Validates and normalizes a search; `400` on a malformed value. */
export function parseBottleSearch(
  raw: BottleSearchQuery,
  defaults: SearchDefaults,
): BottleSearch {
  // A repeated key (`?q=a&q=b`) arrives as an array: keep the first value.
  const query: BottleSearchQuery = {};
  for (const key of BOTTLE_SEARCH_KEYS) {
    const v: unknown = raw[key];
    const first: unknown = Array.isArray(v) ? v[0] : v;
    if (typeof first === 'string') query[key] = first;
  }
  const text = parseTextQuery(query.q);
  const kind = query.kind?.trim()
    ? oneOf('kind', query.kind, SMWS_BOTTLE_KINDS, 'single_cask')
    : null;
  const profile = textParam(query.profile);
  const cask = textParam(query.cask);
  return {
    text,
    status: oneOf('status', query.status, BOTTLE_STATUSES, defaults.status),
    kind,
    category: textParam(query.category)?.toLowerCase() ?? null,
    distilleryCode: textParam(query.distillery_code)?.toUpperCase() ?? null,
    regionId: textParam(query.region_id),
    profileKey: profile ? profileKey(profile) || null : null,
    caskWords: cask
      ? fold(cask).split(/\s+/).filter(Boolean).slice(0, MAX_WORDS)
      : [],
    abv: range(query, 'abv_min', 'abv_max'),
    age: range(query, 'age_min', 'age_max'),
    price: range(query, 'price_min', 'price_max'),
    distilledYears: range(query, 'distilled_from', 'distilled_to'),
    releasedYears: range(query, 'released_from', 'released_to'),
    sort: oneOf(
      'sort',
      query.sort,
      BOTTLE_SORTS,
      text ? 'relevance' : 'released',
    ),
    order:
      oneOf('order', query.order, ['asc', 'desc'] as const, 'desc') === 'asc'
        ? 'ASC'
        : 'DESC',
    limit: intParam('limit', query.limit, defaults.limit, defaults.maxLimit),
    offset: intParam('offset', query.offset, 0, Number.MAX_SAFE_INTEGER),
  };
}
