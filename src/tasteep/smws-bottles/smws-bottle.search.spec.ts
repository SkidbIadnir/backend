import { BadRequestException } from '@nestjs/common';
import {
  fold,
  LIST_DEFAULTS,
  parseBottleSearch,
  parseTextQuery,
  profileKey,
  SEARCH_DEFAULTS,
} from './smws-bottle.search';

describe('parseTextQuery', () => {
  it.each([
    ['5.138', '5.138'],
    ['  5.138 ', '5.138'],
    ['5,138', '5.138'],
    ['5-138', '5.138'],
    ['5 138', '5.138'],
    ['g8.22', 'G8.22'],
    ['rw6 5', 'RW6.5'],
    ['29.', '29.'],
    ['29.2', '29.2'],
  ])('reads %p as the code prefix %p', (q, code) => {
    expect(parseTextQuery(q)).toEqual({ type: 'code', code });
  });

  it('reads a distillery code alone as words that may also be a code', () => {
    expect(parseTextQuery('g1')).toEqual({
      type: 'words',
      words: ['g1'],
      folded: 'g1',
      distilleryCode: 'G1',
    });
  });

  it('folds case and accents and drops repeated words', () => {
    expect(parseTextQuery('Ménage  À ménage')).toEqual({
      type: 'words',
      words: ['menage', 'a'],
      folded: 'menage a menage',
      distilleryCode: null,
    });
  });

  it('keeps names that only look a little like codes as words', () => {
    expect(parseTextQuery('lot 40')?.type).toBe('words');
    expect(parseTextQuery('laphroaig 10')?.type).toBe('words');
  });

  it('ignores blank text', () => {
    expect(parseTextQuery('   ')).toBeNull();
    expect(parseTextQuery(undefined)).toBeNull();
  });
});

describe('fold / profileKey', () => {
  it('matches spelling variants of a profile', () => {
    expect(profileKey('Deep, Rich & Dried Fruits')).toBe(
      profileKey('deep rich dried fruits'),
    );
    expect(fold('Sanlúcar Crème')).toBe('sanlucar creme');
  });
});

describe('parseBottleSearch', () => {
  it('searches everything, best match first, 20 per page', () => {
    const s = parseBottleSearch({ q: 'smoke' }, SEARCH_DEFAULTS);
    expect(s).toMatchObject({
      status: 'all',
      sort: 'relevance',
      order: 'DESC',
      limit: 20,
      offset: 0,
    });
  });

  it('lists available bottles by release without text', () => {
    expect(parseBottleSearch({}, LIST_DEFAULTS)).toMatchObject({
      text: null,
      status: 'available',
      sort: 'released',
      limit: 50,
    });
  });

  it('normalizes the filters', () => {
    const s = parseBottleSearch(
      {
        kind: 'Blend',
        category: 'Rum',
        distillery_code: ' g1 ',
        profile: 'Deep, Rich & Dried Fruits',
        cask: 'Oloroso  Butt',
        abv_min: '55,5',
        age_max: '20',
        distilled_from: '1990',
        sort: 'ABV',
        order: 'asc',
      },
      SEARCH_DEFAULTS,
    );
    expect(s).toMatchObject({
      kind: 'blend',
      category: 'rum',
      distilleryCode: 'G1',
      profileKey: 'deeprichdriedfruits',
      caskWords: ['oloroso', 'butt'],
      abv: { min: 55.5, max: null },
      age: { min: null, max: 20 },
      distilledYears: { min: 1990, max: null },
      sort: 'abv',
      order: 'ASC',
    });
  });

  it('keeps the first value of a repeated key', () => {
    const s = parseBottleSearch(
      { q: ['islay', 'speyside'] as unknown as string },
      SEARCH_DEFAULTS,
    );
    expect(s.text).toMatchObject({ words: ['islay'] });
  });

  it.each([
    [{ status: 'gone' }],
    [{ kind: 'gin' }],
    [{ sort: 'name' }],
    [{ order: 'up' }],
    [{ limit: '101' }],
    [{ limit: 'abc' }],
    [{ offset: '-1' }],
    [{ abv_min: 'strong' }],
    [{ age_min: '20', age_max: '10' }],
  ])('400s on %o', (query) => {
    expect(() => parseBottleSearch(query, SEARCH_DEFAULTS)).toThrow(
      BadRequestException,
    );
  });
});
