import type { TasteepFlavour } from '../entities/tasteep-flavour.entity';
import { normalizeName, slugify } from '../regions/regions.service';

/** Shape of `src/tasteep/data/flavours.json`. */
export interface FlavourSeedFile {
  _comment?: string;
  flavours: FlavourSeedEntry[];
}
export interface FlavourSeedEntry {
  /** Only when it isn't the one derived from `name_en`. */
  id?: string;
  name_en: string;
  name_fr: string;
  aliases?: string[];
  sub?: Omit<FlavourSeedEntry, 'sub'>[];
}

export type FlavourRow = Pick<
  TasteepFlavour,
  'id' | 'nameEn' | 'nameFr' | 'parentId' | 'sortOrder' | 'aliases'
>;

/**
 * The key a tag is matched on: case, accents, surrounding/inner spacing and
 * a leading `#` don't count (`" #Tourbé "` → `tourbe`).
 */
export function normalizeTag(text: string): string {
  return normalizeName(text.trim().replace(/^#+/, ''));
}

/**
 * What a tasting stores in `tags`: each tag trimmed with inner spacing
 * collapsed, empty ones dropped, and later duplicates (same `normalizeTag`)
 * dropped. The first spelling is kept as typed.
 */
export function cleanTags(
  tags: readonly string[] | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    const key = normalizeTag(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Id of a category, or of a flavour under `parentId`. */
export function flavourId(nameEn: string, parentId: string | null): string {
  const slug = slugify(nameEn);
  return parentId ? `${parentId}/${slug}` : slug;
}

/** Builds the rows the seed file describes, categories before their flavours. */
export function seedRows(file: FlavourSeedFile): FlavourRow[] {
  const rows: FlavourRow[] = [];
  file.flavours.forEach((cat, i) => {
    const catId = cat.id ?? flavourId(cat.name_en, null);
    rows.push({
      id: catId,
      nameEn: cat.name_en,
      nameFr: cat.name_fr,
      parentId: null,
      sortOrder: i,
      aliases: cat.aliases ?? [],
    });
    (cat.sub ?? []).forEach((f, j) => {
      rows.push({
        id: f.id ?? flavourId(f.name_en, catId),
        nameEn: f.name_en,
        nameFr: f.name_fr,
        parentId: catId,
        sortOrder: j,
        aliases: f.aliases ?? [],
      });
    });
  });
  return rows;
}

/** Turns live rows back into the seed file's format, keeping the bundled file's comment. */
export function toSeedFile(
  rows: FlavourRow[],
  bundled: FlavourSeedFile,
): FlavourSeedFile {
  const sorted = [...rows].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );
  const entry = (r: FlavourRow, parentId: string | null) => ({
    ...(flavourId(r.nameEn, parentId) !== r.id ? { id: r.id } : {}),
    name_en: r.nameEn,
    name_fr: r.nameFr,
    ...(r.aliases.length ? { aliases: r.aliases } : {}),
  });
  return {
    ...(bundled._comment ? { _comment: bundled._comment } : {}),
    flavours: sorted
      .filter((r) => r.parentId === null)
      .map((cat) => {
        const sub = sorted.filter((r) => r.parentId === cat.id);
        return {
          ...entry(cat, null),
          ...(sub.length ? { sub: sub.map((f) => entry(f, cat.id)) } : {}),
        };
      }),
  };
}

/** Every key a row answers to: its id, both names, its aliases. */
export function rowKeys(
  r: Pick<FlavourRow, 'id' | 'nameEn' | 'nameFr' | 'aliases'>,
): string[] {
  return [
    ...new Set(
      [r.id, r.nameEn, r.nameFr, ...r.aliases]
        .map(normalizeTag)
        .filter(Boolean),
    ),
  ];
}

/**
 * Normalised key → flavour id, over live rows. When two rows claim the same
 * key, ids beat names and names beat aliases; within a tier the smaller id
 * wins, so the result doesn't depend on row order. The admin API refuses to
 * create such clashes; this only keeps lookups deterministic if one slips in.
 */
export function buildFlavourIndex(rows: FlavourRow[]): Map<string, string> {
  const index = new Map<string, string>();
  const sorted = [...rows].sort((a, b) => byCodePoint(a.id, b.id));
  const tiers: ((r: FlavourRow) => string[])[] = [
    (r) => [r.id],
    (r) => [r.nameEn, r.nameFr],
    (r) => r.aliases,
  ];
  for (const tier of tiers) {
    for (const r of sorted) {
      for (const text of tier(r)) {
        const key = normalizeTag(text);
        if (key && !index.has(key)) index.set(key, r.id);
      }
    }
  }
  return index;
}

/** The distinct flavour ids `tags` resolve to, in tag order. Unmatched tags are skipped. */
export function resolveTags(
  tags: readonly string[],
  index: Map<string, string>,
): string[] {
  const ids: string[] = [];
  for (const tag of tags) {
    const id = index.get(normalizeTag(tag));
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Locale-independent order, so results don't depend on the server's ICU data. */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One entry of `GET /admin/flavours/unmatched`. */
export interface UnmatchedTagJson {
  /** The normalised key; add it (or any spelling) as an alias to map it. */
  key: string;
  /** How users actually wrote it, most used first. */
  spellings: { tag: string; count: number }[];
  tasting_count: number;
  user_count: number;
}

/**
 * Groups `(tag, user, count)` rows by normalised key, keeps the keys `index`
 * doesn't match, most users first, then most tastings, then key.
 */
export function groupUnmatched(
  raw: { tag: string; user_id: string; count: number }[],
  index: Map<string, string>,
): UnmatchedTagJson[] {
  const groups = new Map<
    string,
    { spellings: Map<string, number>; users: Set<string>; tastings: number }
  >();
  for (const { tag, user_id, count } of raw) {
    const key = normalizeTag(tag);
    if (!key || index.has(key)) continue;
    const g = groups.get(key) ?? {
      spellings: new Map<string, number>(),
      users: new Set<string>(),
      tastings: 0,
    };
    g.spellings.set(tag, (g.spellings.get(tag) ?? 0) + count);
    g.users.add(user_id);
    g.tastings += count;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      spellings: [...g.spellings.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || byCodePoint(a.tag, b.tag)),
      tasting_count: g.tastings,
      user_count: g.users.size,
    }))
    .sort(
      (a, b) =>
        b.user_count - a.user_count ||
        b.tasting_count - a.tasting_count ||
        byCodePoint(a.key, b.key),
    );
}

/**
 * Aliases as they should be stored: trimmed, without duplicates and without
 * those that only repeat the row's own id or names.
 */
export function cleanAliases(
  aliases: readonly string[],
  own: Pick<FlavourRow, 'id' | 'nameEn' | 'nameFr'>,
): string[] {
  const taken = new Set([own.id, own.nameEn, own.nameFr].map(normalizeTag));
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = raw.trim().replace(/\s+/g, ' ');
    const key = normalizeTag(alias);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    out.push(alias);
  }
  return out;
}
