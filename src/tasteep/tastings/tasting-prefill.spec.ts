import type { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import {
  ageStatement,
  codeInName,
  prefillName,
  tastingCategory,
} from './tasting-prefill';

const bottle = (over: Partial<TasteepSmwsBottle> = {}) =>
  ({
    kind: 'single_cask',
    code: '29.311',
    name: 'Diesel à la crème',
    smwsCode: { distilleryName: 'Laphroaig', category: 'single malt' },
    categories: [],
    ...over,
  }) as TasteepSmwsBottle;

describe('tasting prefill', () => {
  it('names a single cask by code and name, anything else by name', () => {
    expect(prefillName(bottle())).toBe('29.311 Diesel à la crème');
    expect(
      prefillName(bottle({ kind: 'blend', code: null, name: 'Twist & Stout' })),
    ).toBe('Twist & Stout');
  });

  it.each([
    ['single malt', 'whisky'],
    ['grain whisky', 'whisky'],
    ['bourbon', 'whisky'],
    ['rye whiskey', 'whisky'],
    ['corn_whiskey', 'whisky'],
    ['rum', 'rum'],
    ['cognac', 'other'],
    ['gin', 'other'],
  ])('maps the code category %p to %p', (category, expected) => {
    expect(
      tastingCategory(
        bottle({ smwsCode: { category } as TasteepSmwsBottle['smwsCode'] }),
      ),
    ).toBe(expected);
  });

  it('falls back to the shop categories, then whisky for blends', () => {
    const noCode = { smwsCode: null, code: null };
    expect(
      tastingCategory(
        bottle({ ...noCode, kind: 'other', categories: ['All Rum/Jamaica'] }),
      ),
    ).toBe('rum');
    expect(tastingCategory(bottle({ ...noCode, kind: 'blend' }))).toBe(
      'whisky',
    );
    expect(tastingCategory(bottle({ ...noCode, kind: 'other' }))).toBe('other');
  });

  it('writes the age the way the journal does', () => {
    expect(ageStatement('14 years')).toBe('14');
    expect(ageStatement('1 year')).toBe('1');
    expect(ageStatement('16 & 21 years')).toBe('16 & 21 years');
    expect(ageStatement(null)).toBeNull();
  });

  it.each([
    ['29.311 Diesel à la crème', '29.311'],
    ['smws g8.22', 'G8.22'],
    ['RW6.5', 'RW6.5'],
    ['1.309: Barrelbutt', '1.309'],
    ['Lagavulin 16', null],
    ['Bowmore 43.5% batch', null],
    ['Laphroaig 10 then 29.311', null],
  ])('finds the code a name starts with: %p', (name, code) => {
    expect(codeInName(name)).toBe(code);
  });
});
