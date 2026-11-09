/**
 * A minimal smws.eu product page with the same three data sources as the
 * real ones: `var BCData`, `window.productJsonData = JSON.parse("…")` and the
 * visible `.productView-info` list. Shapes copied from live pages (Nov 2026).
 */
export interface FakeSmwsPage {
  title?: string;
  sku?: string;
  productId?: number;
  url?: string;
  caskNo?: string;
  /** Visible info list, label → value (labels as displayed, e.g. ` CASK `). */
  info?: Record<string, string>;
  /** `custom_fields`. */
  custom?: Record<string, string>;
  categories?: string[];
  price?: { formatted: string; value: number; currency: string };
  inStock?: boolean | null;
  stockLevel?: number | null;
  /** Leave out the product JSON (only BCData + HTML). */
  noProductJson?: boolean;
  /** `data-flavour-profile` on the main `.productView`. */
  flavourProfileAttr?: string;
}

export function smwsProductPage(p: FakeSmwsPage = {}): string {
  const price = p.price ?? {
    formatted: '€140.00',
    value: 140,
    currency: 'EUR',
  };
  const bcData = {
    csrf_token: 'x',
    product_attributes: {
      sku: p.sku ?? '001309GX0700614',
      price: { with_tax: price },
      stock: p.stockLevel ?? null,
      instock: p.inStock === undefined ? true : p.inStock,
    },
  };
  const productJson = {
    ps_product_id: p.productId ?? 6130,
    ps_product_category: p.categories ?? [
      'All Whisky',
      'All Whisky/New Flavour Profiles/Dried Fruits & Spices',
      'All Whisky/Cask Type/Sherry Casks',
    ],
    ps_product_url: p.url ?? 'https://smws.eu/barrelbutt/',
    ps_product_price: { with_tax: price, tax_label: 'VAT' },
    productId: p.productId ?? 6130,
    productDetails: {
      id: p.productId ?? 6130,
      sku: p.sku ?? '001309GX0700614',
      title: p.title ?? 'Barrelbutt',
      url: p.url ?? 'https://smws.eu/barrelbutt/',
      stock_level:
        p.stockLevel === undefined
          ? '45'
          : p.stockLevel === null
            ? null
            : String(p.stockLevel),
      ...(p.inStock === false ? { out_of_stock: true } : {}),
      custom_fields: Object.entries(
        p.custom ?? {
          Age: '14',
          ABV: '56.3%',
          'Date Distilled': '25/01/2012',
          'Whisky Cask Code': '1.309',
          'Distillery Code': '1',
          'Cask Type': '1st fill ex-oloroso butt',
          Region: 'Speyside',
          'Release Date': '2026-11-06 09:00:00',
        },
      ).map(([name, value], i) => ({ id: i, name, value })),
    },
  };
  const info = p.info ?? {
    ' ABV ': '56.3%',
    Age: '14 years',
    'DISTILLED DATE': '25/01/2012',
    ' CASK ': '1st fill ex-oloroso butt',
    PROFILE: '',
    REGION: 'Speyside',
  };
  const items = Object.entries(info)
    .map(
      ([name, value]) =>
        `<li><span class="productView-info-name">${name}</span> <span class="productView-info-value">${value}</span></li>`,
    )
    .join('\n');
  const productScript = p.noProductJson
    ? ''
    : `<script id="productScript">window.productJsonData = JSON.parse(${JSON.stringify(JSON.stringify(productJson))});</script>`;

  return `<!doctype html><html><head>
<script type="text/javascript">
var BCData = ${JSON.stringify(bcData)};
</script></head><body>
<div class="productView bottle"${p.flavourProfileAttr ? ` data-flavour-profile="${p.flavourProfileAttr.replace(/&/g, '&amp;')}"` : ''}>
<div class="productView-details">
  <h1 class="productView-title">${p.title ?? 'Barrelbutt'}</h1>
  <p class="caskNo">${p.caskNo ?? 'CASK NO. 1.309'}</p>
  <ul class="productView-info">${items}</ul>
</div>
</div>
<section class="related"><div class="productView-details"><p class="caskNo">CASK NO. 99.1</p></div></section>
${productScript}
</body></html>`;
}

export function smwsSitemapIndex(children: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${children
    .map((c) => `<sitemap><loc>${c.replace(/&/g, '&amp;')}</loc></sitemap>`)
    .join('')}</sitemapindex>`;
}

export function smwsUrlSet(urls: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
    .map((u) => `<url><loc>${u}</loc></url>`)
    .join('')}</urlset>`;
}
