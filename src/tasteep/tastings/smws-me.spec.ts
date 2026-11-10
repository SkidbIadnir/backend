import type { TasteepSmwsBottle } from '../entities/tasteep-smws-bottle.entity';
import type { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { makeTasting } from '../test-utils/fixtures';
import { buildSmwsMe, caskFamily } from './smws-me';

const bottle = (over: Partial<TasteepSmwsBottle>) =>
  ({
    kind: 'single_cask',
    batch: null,
    name: 'A dram',
    url: 'https://smws.eu/x',
    smwsCode: null,
    caskNo: null,
    regionText: null,
    regionId: null,
    priceText: null,
    priceAmount: null,
    priceCurrency: null,
    abv: null,
    age: null,
    caskType: null,
    distilledDate: null,
    profile: null,
    categories: [],
    releasedAt: null,
    inStock: false,
    stock: null,
    firstSeenAt: new Date('2026-11-01T00:00:00Z'),
    lastSeenAt: new Date('2026-11-09T00:00:00Z'),
    delistedAt: null,
    ...over,
  }) as TasteepSmwsBottle;

const tasting = (
  id: string,
  b: TasteepSmwsBottle | null,
  score: number | null,
  date = '2026-03-10T19:00:00Z',
): TasteepTasting =>
  makeTasting({
    id,
    smwsBottle: b,
    smwsSku: b?.sku ?? null,
    score,
    dateTasted: new Date(date),
  });

const laphroaigA = bottle({
  sku: 'A',
  code: '29.311',
  distilleryCode: '29',
  profile: 'Bold & Peaty',
  caskType: '1st fill ex-oloroso butt',
});
const laphroaigB = bottle({
  sku: 'B',
  code: '29.307',
  distilleryCode: '29',
  profile: 'Bold, Peaty',
  caskType: 'Refill ex-bourbon barrel',
});
const ardbeg = bottle({
  sku: 'C',
  code: '33.214',
  distilleryCode: '33',
  profile: null,
  caskType: '2nd fill ex-bourbon hogshead & refill red wine barrique',
});

const codes = [
  { code: '1', category: 'single malt', regionId: 'scotland/speyside' },
  { code: '29', category: 'single malt', regionId: 'scotland/islay' },
  { code: '33', category: 'single malt', regionId: 'scotland/islay' },
  { code: 'R1', category: 'rum', regionId: 'jamaica' },
];
const regionNames = new Map([
  ['scotland/speyside', 'Speyside'],
  ['scotland/islay', 'Islay'],
  ['jamaica', 'Jamaica'],
]);

describe('caskFamily', () => {
  it.each([
    ['1st fill ex-oloroso butt', 'oloroso'],
    ['1st fill ex-PX hogshead', 'px'],
    ['Pedro Ximénez butt', 'px'],
    ['2nd fill sherry butt', 'sherry'],
    ['1st fill STR, Oloroso seasoned barrique', 'oloroso'],
    ['1st fill ex-bourbon hogshead & refill red wine barrique', 'wine'],
    ['Tawny port pipe', 'port'],
    ['ex-rum barrel', 'rum'],
    ['1st fill virgin oak barrique', 'virgin_oak'],
    ['New charred oak barrel', 'virgin_oak'],
    ['1st fill HTMC hogshead', 'virgin_oak'],
    ['1st fill #3 char barrel', 'virgin_oak'],
    ['Refill ex-bourbon barrel', 'bourbon'],
    ['Refill hogshead', 'other'],
  ])('%p → %p', (text, family) => {
    expect(caskFamily(text)).toBe(family);
  });
});

describe('buildSmwsMe', () => {
  const tastings = [
    tasting('t1', laphroaigA, 91, '2026-11-08T19:00:00Z'),
    tasting('t2', laphroaigA, 88, '2026-11-02T19:00:00Z'),
    tasting('t3', laphroaigB, 85),
    tasting('t4', ardbeg, 94),
    tasting('t5', ardbeg, null),
    tasting('t6', null, 99),
  ];
  const me = buildSmwsMe(tastings, codes, regionNames);

  it('counts linked tastings, casks and distilleries in the codes order', () => {
    expect(me.linked_tastings).toBe(5);
    expect(me.linked_casks).toBe(3);
    expect(me.distilleries).toEqual({
      tasted: 2,
      total: 4,
      codes: ['29', '33'],
    });
  });

  it('lists the best tasting of each bottle, best first', () => {
    expect(me.best.map((b) => [b.bottle.code, b.score, b.tasting_id])).toEqual([
      ['33.214', 94, 't4'],
      ['29.311', 91, 't1'],
      ['29.307', 85, 't3'],
    ]);
    expect(me.best[1].date_tasted).toBe('2026-11-08T19:00:00.000Z');
  });

  it('averages scores by profile (spellings merged) and by cask family', () => {
    expect(me.by_profile).toEqual([
      { profile: 'Bold & Peaty', avg_score: 88, count: 3 },
    ]);
    expect(me.by_cask).toEqual([
      { cask: 'wine', avg_score: 94, count: 1 },
      { cask: 'oloroso', avg_score: 89.5, count: 2 },
      { cask: 'bourbon', avg_score: 85, count: 1 },
    ]);
  });

  it('lists what is left to try', () => {
    expect(me.untried.regions).toEqual([
      { region_id: 'scotland/speyside', name: 'Speyside', tasted: 0, total: 1 },
      { region_id: 'jamaica', name: 'Jamaica', tasted: 0, total: 1 },
    ]);
    expect(me.untried.categories).toEqual([
      { category: 'rum', tasted: 0, total: 1 },
    ]);
  });

  it('is empty for a journal without linked tastings', () => {
    const empty = buildSmwsMe([tasting('t', null, 80)], codes, regionNames);
    expect(empty).toMatchObject({
      linked_casks: 0,
      linked_tastings: 0,
      distilleries: { tasted: 0, total: 4, codes: [] },
      best: [],
      by_profile: [],
      by_cask: [],
    });
    expect(empty.untried.categories.map((c) => c.category)).toEqual([
      'single malt',
      'rum',
    ]);
  });
});
