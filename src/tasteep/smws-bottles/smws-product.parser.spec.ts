import {
  smwsProductPage,
  smwsSitemapIndex,
  smwsUrlSet,
} from '../test-utils/smws-page.fixture';
import { parseProductPage, parseSitemap } from './smws-product.parser';

describe('parseProductPage', () => {
  it('reads every source of a single-cask page', () => {
    const page = parseProductPage(smwsProductPage())!;
    expect(page).toEqual(
      expect.objectContaining({
        productId: 6130,
        sku: '001309GX0700614',
        title: 'Barrelbutt',
        url: 'https://smws.eu/barrelbutt/',
        price: { formatted: '€140.00', value: 140, currency: 'EUR' },
        inStock: true,
        stockLevel: 45,
        caskNoText: 'CASK NO. 1.309',
      }),
    );
    expect(page.info).toEqual({
      ABV: '56.3%',
      AGE: '14 years',
      'DISTILLED DATE': '25/01/2012',
      CASK: '1st fill ex-oloroso butt',
      PROFILE: '',
      REGION: 'Speyside',
    });
    expect(page.custom['Whisky Cask Code']).toBe('1.309');
    expect(page.categories).toContain(
      'All Whisky/New Flavour Profiles/Dried Fruits & Spices',
    );
  });

  it('takes the cask number from the product, not a related card', () => {
    const page = parseProductPage(
      smwsProductPage({ caskNo: 'SOCIETY NO. Batch 40' }),
    )!;
    expect(page.caskNoText).toBe('SOCIETY NO. Batch 40');
  });

  it('reads an out-of-stock page from BCData', () => {
    const page = parseProductPage(
      smwsProductPage({ inStock: false, stockLevel: null }),
    )!;
    expect(page.inStock).toBe(false);
  });

  it('falls back to out_of_stock / stock_level without BCData', () => {
    const html = smwsProductPage({ inStock: false, stockLevel: null }).replace(
      /var BCData = .*?;\n/s,
      '',
    );
    expect(parseProductPage(html)!.inStock).toBe(false);
  });

  it('still works from HTML and BCData when the product JSON is missing', () => {
    const page = parseProductPage(smwsProductPage({ noProductJson: true }))!;
    expect(page.title).toBe('Barrelbutt');
    expect(page.sku).toBe('001309GX0700614');
    expect(page.info.ABV).toBe('56.3%');
    expect(page.custom).toEqual({});
  });

  it('returns null for a page with no product at all', () => {
    expect(
      parseProductPage('<html><body><h1>Home</h1></body></html>'),
    ).toBeNull();
  });
});

describe('parseSitemap', () => {
  it('reads child sitemaps from an index', () => {
    const index = smwsSitemapIndex([
      'https://smws.eu/xmlsitemap.php?type=pages&page=1',
      'https://smws.eu/xmlsitemap.php?type=products&page=1',
    ]);
    expect(parseSitemap(index)).toEqual({
      sitemaps: [
        'https://smws.eu/xmlsitemap.php?type=pages&page=1',
        'https://smws.eu/xmlsitemap.php?type=products&page=1',
      ],
      urls: [],
    });
  });

  it('reads product URLs from a urlset', () => {
    expect(
      parseSitemap(
        smwsUrlSet([
          'https://smws.eu/barrelbutt/',
          'https://smws.eu/fruit-bomb/',
        ]),
      ).urls,
    ).toEqual(['https://smws.eu/barrelbutt/', 'https://smws.eu/fruit-bomb/']);
  });
});
