import {
  buildFlavourIndex,
  cleanAliases,
  cleanTags,
  FlavourRow,
  FlavourSeedFile,
  groupUnmatched,
  normalizeTag,
  resolveTags,
  rowKeys,
  seedRows,
  toSeedFile,
} from './flavour.rules';
import * as flavourData from '../data/flavours.json';

const row = (over: Partial<FlavourRow> & { id: string }): FlavourRow => ({
  nameEn: over.id,
  nameFr: over.id,
  parentId: null,
  sortOrder: 0,
  aliases: [],
  ...over,
});

describe('flavour rules', () => {
  it('normalizeTag ignores case, accents, spacing and a leading #', () => {
    expect(normalizeTag(' #Tourbé ')).toBe('tourbe');
    expect(normalizeTag('Fruits  à   noyau')).toBe('fruits a noyau');
    expect(normalizeTag('##')).toBe('');
  });

  it('cleanTags trims, drops empties and later duplicates, keeps the first spelling', () => {
    expect(
      cleanTags([' Tourbé ', 'tourbe', '', '  ', 'my   own', 'TOURBÉ']),
    ).toEqual(['Tourbé', 'my own']);
    expect(cleanTags(null)).toEqual([]);
  });

  it('seedRows derives slug ids, categories before their flavours', () => {
    const rows = seedRows({
      flavours: [
        {
          name_en: 'Smoky',
          name_fr: 'Fumé',
          sub: [{ name_en: 'Toasted oak', name_fr: 'Bois toasté' }],
        },
        { id: 'custom', name_en: 'Other', name_fr: 'Autre' },
      ],
    });
    expect(rows.map((r) => [r.id, r.parentId, r.sortOrder])).toEqual([
      ['smoky', null, 0],
      ['smoky/toasted-oak', 'smoky', 0],
      ['custom', null, 1],
    ]);
  });

  it('toSeedFile round-trips the bundled file', () => {
    const file = flavourData as FlavourSeedFile;
    const back = toSeedFile(seedRows(file), file);
    expect(seedRows(back)).toEqual(seedRows(file));
    expect(back._comment).toBe(file._comment);
  });

  it('resolveTags matches ids, names and aliases, distinct and in tag order', () => {
    const index = buildFlavourIndex([
      row({ id: 'smoky', nameEn: 'Smoky', nameFr: 'Fumé' }),
      row({
        id: 'smoky/peat',
        nameEn: 'Peat',
        nameFr: 'Tourbe',
        parentId: 'smoky',
        aliases: ['peaty', 'tourbé'],
      }),
    ]);
    expect(
      resolveTags(['FUMÉ', 'unknown', 'peaty', 'smoky/peat', 'Tourbée'], index),
    ).toEqual(['smoky', 'smoky/peat']);
  });

  it('buildFlavourIndex: ids beat names beat aliases, whatever the row order', () => {
    const rows = [
      row({ id: 'b', aliases: ['a', 'x'] }),
      row({ id: 'a', nameEn: 'x' }),
    ];
    const index = buildFlavourIndex(rows);
    expect(index.get('a')).toBe('a');
    expect(index.get('x')).toBe('a');
    expect(buildFlavourIndex([...rows].reverse())).toEqual(index);
  });

  it('cleanAliases drops blanks, duplicates and repeats of the own id or names', () => {
    expect(
      cleanAliases([' peaty ', 'Peaty', 'Tourbe', 'smoky/peat', 'tourbé', ''], {
        id: 'smoky/peat',
        nameEn: 'Peat',
        nameFr: 'Tourbe',
      }),
    ).toEqual(['peaty']);
  });

  it('groupUnmatched merges spellings across users and skips matched keys', () => {
    const index = new Map([['peat', 'smoky/peat']]);
    const out = groupUnmatched(
      [
        { tag: 'Cire', user_id: 'u1', count: 2 },
        { tag: 'cire', user_id: 'u2', count: 1 },
        { tag: 'cire', user_id: 'u1', count: 1 },
        { tag: 'wax', user_id: 'u3', count: 5 },
        { tag: 'Peat', user_id: 'u1', count: 9 },
      ],
      index,
    );
    expect(out).toEqual([
      {
        key: 'cire',
        spellings: [
          { tag: 'Cire', count: 2 },
          { tag: 'cire', count: 2 },
        ],
        tasting_count: 4,
        user_count: 2,
      },
      {
        key: 'wax',
        spellings: [{ tag: 'wax', count: 5 }],
        tasting_count: 5,
        user_count: 1,
      },
    ]);
  });

  describe('bundled flavours.json', () => {
    const rows = seedRows(flavourData);

    it('has unique ids and no key claimed by two rows', () => {
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
      const owners = new Map<string, string>();
      const clashes: string[] = [];
      for (const r of rows) {
        for (const key of rowKeys(r)) {
          const owner = owners.get(key);
          if (owner && owner !== r.id)
            clashes.push(`${key}: ${owner} / ${r.id}`);
          owners.set(key, r.id);
        }
      }
      expect(clashes).toEqual([]);
    });

    it('stores aliases already clean', () => {
      for (const r of rows)
        expect(cleanAliases(r.aliases, r)).toEqual(r.aliases);
    });

    it("resolves the app's current suggestion chips in both languages", () => {
      const index = buildFlavourIndex(rows);
      const en = 'floral,honeyed,coastal,peaty,smoky,sherried'.split(',');
      const fr = 'floral,miellé,côtier,tourbé,fumé,sherry'.split(',');
      const expected = [
        'floral',
        'sweet/honey',
        'coastal',
        'smoky/peat',
        'smoky',
        'winey/sherry',
      ];
      expect(en.map((t) => index.get(normalizeTag(t)))).toEqual(expected);
      expect(fr.map((t) => index.get(normalizeTag(t)))).toEqual(expected);
    });
  });
});
