import { smwsProductPage } from '../test-utils/smws-page.fixture';
import {
  BottleRead,
  codeFromSku,
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
      kindFromCode: true,
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

  it('repairs double-encoded titles and fields', () => {
    const bottle = read(
      smwsProductPage({
        title: 'PÃ¢tisserie au jardin',
        info: { ABV: '56%', CASK: 'CrÃ¨me brÃ»lÃ©e cask' },
      }),
    )!;
    expect(bottle.name).toBe('Pâtisserie au jardin');
    expect(bottle.caskType).toBe('Crème brûlée cask');
    expect(read(smwsProductPage({ title: 'A dÃ© jÃ -vu' }))!.name).toBe(
      'A dé jà-vu',
    );
    expect(
      read(smwsProductPage({ title: 'Touched by a bearâ€™s paw' }))!.name,
    ).toBe('Touched by a bear’s paw');
  });

  it('reads an ABV given as a fraction', () => {
    expect(read(smwsProductPage({ info: { ABV: '0.556%' } }))!.abv).toBe(55.6);
  });

  it('drops a €0.00 price', () => {
    const bottle = read(
      smwsProductPage({
        price: { formatted: '€0.00', value: 0, currency: 'EUR' },
      }),
    )!;
    expect([
      bottle.priceText,
      bottle.priceAmount,
      bottle.priceCurrency,
    ]).toEqual([null, null, null]);
  });

  describe('kind', () => {
    const page = (custom: Record<string, string>, extra = {}) =>
      read(
        smwsProductPage({
          caskNo: '',
          info: { ABV: '50%', AGE: custom.Age ? `${custom.Age} years` : '' },
          custom: { ABV: '50%', ...custom },
          ...extra,
        }),
      )!;

    it('makes an SM code a blend, with the code as its batch', () => {
      expect(page({ 'Whisky Cask Code': 'SM0.001', Age: '7' })).toEqual(
        expect.objectContaining({
          kind: 'blend',
          kindFromCode: true,
          code: null,
          distilleryCode: null,
          batch: 'SM0.001',
        }),
      );
    });

    it('makes two casks in one product `other`', () => {
      const duo = page({ 'Whisky Cask Code': '24.182 & 19.102', Age: '16' });
      expect([duo.kind, duo.code, duo.kindFromCode]).toEqual([
        'other',
        null,
        true,
      ]);
      expect(
        read(smwsProductPage({ info: { ABV: '56%', AGE: '16 & 21 years' } }))!
          .kind,
      ).toBe('other');
    });

    it('keeps a blend label as written', () => {
      expect(
        page({ 'Whisky Cask Code': 'Distillery 68 Rare Release', Age: '14' })
          .batch,
      ).toBe('Distillery 68 Rare Release');
      expect(page({ 'Society Code': 'batch 42', Age: '10' }).batch).toBe(
        'Batch 42',
      );
    });

    it('tells blends from packs and other spirits without a code', () => {
      const kind = (custom: Record<string, string>) =>
        page(custom, { sku: 'PACK-01' }).kind;
      expect(kind({ 'Spirit Type': 'Malt Whisky', Age: '12' })).toBe('blend');
      expect(kind({ 'Spirit Type': 'Blended Malt' })).toBe('blend');
      expect(kind({ Age: '14' })).toBe('blend');
      expect(kind({ 'Spirit Type': 'Malt Whisky' })).toBe('other'); // tasting pack
      expect(kind({})).toBe('other'); // beer, sherry pair
      expect(kind({ 'Spirit Type': 'Gin' })).toBe('other');
      expect(kind({ 'Spirit Type': 'Jamaican Rum', Age: '8' })).toBe('other');
    });

    it('takes a single cask code from the SKU when the page shows none', () => {
      expect(
        page(
          { 'Spirit Type': 'Malt Whisky', Age: '10' },
          { sku: '005138EU0700610' },
        ),
      ).toEqual(
        expect.objectContaining({
          kind: 'single_cask',
          kindFromCode: false,
          code: '5.138',
          distilleryCode: '5',
        }),
      );
    });
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
    kindFromCode: false,
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

  it('reclassifies on a read that shows the kind in its code', () => {
    const merged = mergeBottle(
      stored,
      { ...emptyRead, kind: 'blend', kindFromCode: true, batch: 'SM0.001' },
      null,
    );
    expect(merged).toEqual(
      expect.objectContaining({
        kind: 'blend',
        code: null,
        distilleryCode: null,
        caskNo: null,
        batch: 'SM0.001',
      }),
    );
  });

  it('fixes stored values a better read corrects', () => {
    const merged = mergeBottle(
      { ...stored, name: 'PÃ¢tisserie', abv: 0.6 },
      read(smwsProductPage({ title: 'PÃ¢tisserie', info: { ABV: '0.556%' } }))!,
      null,
    );
    expect([merged.name, merged.abv]).toEqual(['Pâtisserie', 55.6]);
  });

  it('drops a stored €0.00 price', () => {
    const merged = mergeBottle(
      { ...stored, priceText: '€0.00', priceAmount: 0 },
      emptyRead,
      null,
    );
    expect([
      merged.priceText,
      merged.priceAmount,
      merged.priceCurrency,
    ]).toEqual([null, null, null]);
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

describe('codeFromSku', () => {
  it.each([
    ['001309GX0700614', '1.309'],
    ['121118EU0700609', '121.118'],
    ['0G8022GX0700632', 'G8.22'],
    ['RW6005GX0700608', 'RW6.5'],
    ['SM0120EU0700610', null],
    ['BAT010GX0700610', null],
    ['GX0745125960654', null],
    ['PITCHBLACK-BEER-3PACK', null],
    [null, null],
  ])('%s → %s', (sku, expected) => {
    expect(codeFromSku(sku)).toBe(expected);
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
