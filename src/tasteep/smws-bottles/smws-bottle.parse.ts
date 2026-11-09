export const SMWS_BASE_URL = 'https://smws.eu';

/**
 * One canonical form for a product URL, so a listing `href` (often relative)
 * and the stored URL compare equal: absolute against smws.eu, lowercase host,
 * no query string or fragment, no trailing slash. `null` when unparseable.
 */
export function normalizeProductUrl(
  href: string | null | undefined,
): string | null {
  const raw = href?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, SMWS_BASE_URL);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `https://${url.host.toLowerCase()}${path}`;
}

/** `1.234` → `{ distilleryCode: '1', caskNo: '234' }`; `null` for anything else. */
export function splitSmwsCode(
  text: string | null | undefined,
): { code: string; distilleryCode: string; caskNo: string } | null {
  const match = text?.match(/([A-Za-z]*\d+)\.(\d+)/);
  if (!match) return null;
  const distilleryCode = match[1].toUpperCase();
  return {
    code: `${distilleryCode}.${match[2]}`,
    distilleryCode,
    caskNo: match[2],
  };
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  '€': 'EUR',
  '£': 'GBP',
  $: 'USD',
};

/** Reads a number written with either `,` or `.` as decimal separator. */
function parseLocaleNumber(text: string): number | null {
  let digits = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(digits)) return null;
  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Both present: the last one is the decimal separator.
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    digits = digits.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma > -1) {
    // Only commas: decimal when followed by 1–2 digits at the end (`85,50`).
    digits = /,\d{1,2}$/.test(digits)
      ? digits.replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '')
      : digits.replace(/,/g, '');
  }
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/** `€1,234.50` → `{ amount: 1234.5, currency: 'EUR' }`. */
export function parsePrice(text: string | null | undefined): {
  amount: number | null;
  currency: string | null;
} {
  if (!text?.trim()) return { amount: null, currency: null };
  const symbol = Object.keys(CURRENCY_SYMBOLS).find((s) => text.includes(s));
  const code = text.match(/\b(EUR|GBP|USD)\b/i)?.[1]?.toUpperCase();
  return {
    amount: parseLocaleNumber(text),
    currency: symbol ? CURRENCY_SYMBOLS[symbol] : (code ?? null),
  };
}

/** `58.3%` / `58,3 %` → `58.3`; `null` outside 0–100. */
export function parseAbv(text: string | null | undefined): number | null {
  if (!text?.trim()) return null;
  const value = parseLocaleNumber(text);
  return value !== null && value > 0 && value <= 100 ? value : null;
}

/** `25/01/2012` (or `25/01/12`) → `2012-01-25`; `null` when not a valid `dd/mm/yy[yy]` date. */
export function parseDistilledDate(
  text: string | null | undefined,
): string | null {
  const m = text?.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/);
  if (!m) return null;
  // Two-digit years (`11/01/18`): 00–49 → 2000s, 50–99 → 1900s.
  const yy = Number(m[3]);
  const year = m[3].length === 2 ? (yy < 50 ? 2000 + yy : 1900 + yy) : yy;
  const [day, month] = [Number(m[1]), Number(m[2])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Trimmed text, or `null` when empty. */
export const textOrNull = (v: string | null | undefined): string | null =>
  v?.trim() ? v.trim() : null;
