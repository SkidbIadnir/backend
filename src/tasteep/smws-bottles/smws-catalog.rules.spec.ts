import { smwsProductPage } from '../test-utils/smws-page.fixture';
import {
  BottleRead,
  mergeBottle,
  parseReleaseDate,
  profileFromCategories,
  readBottle,
  StoredBottle,
  stockChange,
} from './smws-catalog.rules';
import { parseProductPage } from './smws-product.parser';

const URL = 'https://smws.eu/barrelbutt';
const read = (html: string, url = URL) =>
  readBottle(parseProductPage(html)!, url);

describe('readBottle', () => {
  it('reads a single cask in the same format as the Playwright scraper', () => {
    expect(read(smwsProductPage())).toEqual({
      sku: '001309GX0700614',
      productId: 6130,
      url: URL,
      kind: 'single_cask',
      code: '1.309',
      distilleryCode: '1',
      caskNo: '309',
      batch: null,
      name: 'Barrelbutt',
      priceText: '€140.00',
      priceAmount: 140,
      priceCurrency: 'EUR',
      abv: 56.3,
      age: '14 years',
      caskType: '1st fill ex-oloroso butt',
      distilledDate: '2012-01-25',
      profile: 'Dried Fruits & Spices',
      regionText: 'Speyside',
      categories: expect.any(Array) as unknown,
      releasedAt: new Date('2026-11-06T09:00:00Z'),
      inStock: true,
      stock: 45,
    });
  });

  it('reads a blend: no code, the batch instead', () => {
    const bottle = read(
      smwsProductPage({
        title: 'Fruit Bomb',
        sku: 'SM0120EU0700610',
        caskNo: 'SOCIETY NO. Batch 40',
        custom: {
          Age: '10',
          ABV: '50%',
          'Date Distilled': '13/02/2015',
          'Whisky Cask Code': 'Batch 40',
          'Distillery Code': 'SM0',
          'Society Code': 'Batch 40',
          'Cask Type': '1st fill bourbon casks',
        },
        info: {
          ABV: '50%',
          Age: '10 years',
          'DISTILLED DATE': '13/02/2015',
          CASK: '1st fill bourbon casks',
          PROFILE: '',
        },
        categories: ['All Whisky', 'All Whisky/Whisky/Heresy'],
      }),
    )!;
    expect(bottle).toEqual(
      expect.objectContaining({
        sku: 'SM0120EU0700610',
        kind: 'blend',
        code: null,
        distilleryCode: null,
        batch: 'Batch 40',
        name: 'Fruit Bomb',
        distilledDate: '2015-02-13',
        caskType: '1st fill bourbon casks',
        regionText: null,
        profile: null,
      }),
    );
  });

  it('falls back to custom_fields when the info list lacks a value', () => {
    const bottle = read(
      smwsProductPage({ info: { ABV: '', AGE: '', CASK: '', REGION: '' } }),
    )!;
    expect(bottle).toEqual(
      expect.objectContaining({
        abv: 56.3,
        age: '14 years',
        caskType: '1st fill ex-oloroso butt',
        distilledDate: '2012-01-25',
        regionText: 'Speyside',
      }),
    );
  });

  it('prefers the info list when both have a value', () => {
    const bottle = read(
      smwsProductPage({
        info: {
          CASK: 'Refill ex-bourbon hogshead',
          REGION: 'Islay',
          ABV: '58.1%',
        },
      }),
    )!;
    expect(bottle.caskType).toBe('Refill ex-bourbon hogshead');
    expect(bottle.regionText).toBe('Islay');
    expect(bottle.abv).toBe(58.1);
  });

  it('reads the profile from data-flavour-profile, then custom_fields, then categories', () => {
    const archived = { categories: ['All Whisky', 'Bottle Archive'] };
    expect(
      read(
        smwsProductPage({
          ...archived,
          flavourProfileAttr: 'Toasted Oak & Vanilla',
        }),
      )!.profile,
    ).toBe('Toasted Oak & Vanilla');
    expect(
      read(
        smwsProductPage({
          ...archived,
          custom: { ABV: '50%', 'Flavour Profile': 'Sweet Fruity & Mellow' },
        }),
      )!.profile,
    ).toBe('Sweet Fruity & Mellow');
    expect(read(smwsProductPage(archived))!.profile).toBeNull();
  });

  it('reads two-digit-year distilled dates', () => {
    const bottle = read(
      smwsProductPage({ info: { ABV: '56%', 'DISTILLED DATE': '11/01/18' } }),
    )!;
    expect(bottle.distilledDate).toBe('2018-01-11');
  });

  it('takes the code from the cask number when custom_fields lack it', () => {
    const bottle = read(smwsProductPage({ custom: { ABV: '56.3%' } }))!;
    expect(bottle.code).toBe('1.309');
  });

  it('is null for a product without an ABV (not a drink)', () => {
    expect(
      read(
        smwsProductPage({
          info: { Size: 'One size' },
          custom: { Material: 'Glass' },
        }),
      ),
    ).toBeNull();
  });
});

describe('mergeBottle', () => {
  const stored: StoredBottle = {
    ...read(smwsProductPage())!,
    name: 'Barrelbutt',
    inStock: true,
    regionId: 'scotland/speyside',
    categories: ['All Whisky/New Flavour Profiles/Dried Fruits & Spices'],
  };
  const emptyRead: BottleRead = {
    sku: '001309GX0700614',
    productId: null,
    url: URL,
    kind: 'blend',
    code: null,
    distilleryCode: null,
    caskNo: null,
    batch: null,
    name: null,
    priceText: null,
    priceAmount: null,
    priceCurrency: null,
    abv: null,
    age: null,
    caskType: null,
    distilledDate: null,
    profile: null,
    regionText: null,
    categories: ['Bottle Archive'],
    releasedAt: null,
    inStock: false,
    stock: null,
  };

  it('never erases a stored value with a missing one', () => {
    const merged = mergeBottle(stored, emptyRead, null);
    for (const key of [
      'code',
      'distilleryCode',
      'caskNo',
      'name',
      'priceText',
      'priceAmount',
      'priceCurrency',
      'abv',
      'age',
      'caskType',
      'distilledDate',
      'profile',
      'regionText',
      'regionId',
      'releasedAt',
      'productId',
    ] as const) {
      expect(merged[key]).toEqual(stored[key]);
    }
    expect(merged.kind).toBe('single_cask');
  });

  it('keeps every category ever seen', () => {
    expect(mergeBottle(stored, emptyRead, null).categories).toEqual([
      'All Whisky/New Flavour Profiles/Dried Fruits & Spices',
      'Bottle Archive',
    ]);
  });

  it('takes new price, stock and availability', () => {
    const merged = mergeBottle(
      stored,
      {
        ...read(
          smwsProductPage({
            price: { formatted: '€150.00', value: 150, currency: 'EUR' },
            stockLevel: 3,
          }),
        )!,
      },
      'scotland/speyside',
    );
    expect(merged).toEqual(
      expect.objectContaining({
        priceAmount: 150,
        priceText: '€150.00',
        stock: 3,
        inStock: true,
      }),
    );
  });

  it('sets stock to 0 when sold out without a count, and keeps availability when the page says nothing', () => {
    expect(mergeBottle(stored, emptyRead, null).stock).toBe(0);
    expect(
      mergeBottle(stored, { ...emptyRead, inStock: null }, null).inStock,
    ).toBe(true);
  });

  it('uses the SKU it already has when matched by code', () => {
    const merged = mergeBottle(
      stored,
      { ...read(smwsProductPage())!, sku: 'OTHER' },
      null,
    );
    expect(merged.sku).toBe('001309GX0700614');
  });
});

describe('stockChange', () => {
  it.each([
    [null, true, null],
    [null, false, null],
    [true, true, null],
    [true, false, 'delisted'],
    [false, true, 'relisted'],
  ] as const)('stored %s → read %s: %s', (before, after, expected) => {
    expect(
      stockChange(before === null ? null : { inStock: before }, {
        inStock: after,
      }),
    ).toBe(expected);
  });
});

describe('profileFromCategories', () => {
  it('prefers the new taxonomy', () => {
    expect(
      profileFromCategories([
        'All Whisky/Legacy Flavour Profiles/Spicy & Dry',
        'All Whisky/New Flavour Profiles/Sweet & Zesty',
      ]),
    ).toBe('Sweet & Zesty');
  });

  it('ignores bare family categories', () => {
    expect(
      profileFromCategories(['All Whisky/Legacy Flavour Profiles']),
    ).toBeNull();
  });
});

describe('parseReleaseDate', () => {
  it.each([
    ['2026-11-06 09:00:00', '2026-11-06T09:00:00.000Z'],
    ['2026-11-06', '2026-11-06T00:00:00.000Z'],
    ['06/11/2026', null],
    [undefined, null],
  ])('%s', (text, expected) => {
    expect(parseReleaseDate(text)?.toISOString() ?? null).toBe(expected);
  });
});
