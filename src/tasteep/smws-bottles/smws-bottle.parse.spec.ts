import {
  normalizeProductUrl,
  parseAbv,
  parsePrice,
  splitSmwsCode,
} from './smws-bottle.parse';

describe('normalizeProductUrl', () => {
  it('makes relative hrefs absolute and equal to the stored form', () => {
    expect(normalizeProductUrl('/41-176-a-dram-for-ishtar/')).toBe(
      'https://smws.eu/41-176-a-dram-for-ishtar',
    );
    expect(
      normalizeProductUrl(
        'https://SMWS.eu/41-176-a-dram-for-ishtar?utm=x#reviews',
      ),
    ).toBe('https://smws.eu/41-176-a-dram-for-ishtar');
  });

  it('rejects empty and non-http values', () => {
    expect(normalizeProductUrl('')).toBeNull();
    expect(normalizeProductUrl(undefined)).toBeNull();
    expect(normalizeProductUrl('javascript:void(0)')).toBeNull();
  });
});

describe('splitSmwsCode', () => {
  it.each([
    ['Cask No. 1.234', { code: '1.234', distilleryCode: '1', caskNo: '234' }],
    ['g1.12', { code: 'G1.12', distilleryCode: 'G1', caskNo: '12' }],
    ['RW1.5', { code: 'RW1.5', distilleryCode: 'RW1', caskNo: '5' }],
  ])('%s', (text, expected) => {
    expect(splitSmwsCode(text)).toEqual(expected);
  });

  it('returns null without a code', () => {
    expect(splitSmwsCode('Gift card')).toBeNull();
  });
});

describe('parsePrice', () => {
  it.each([
    ['€95.00', 95, 'EUR'],
    ['£1,234.50', 1234.5, 'GBP'],
    ['85,50 €', 85.5, 'EUR'],
    ['1.234,50 €', 1234.5, 'EUR'],
    ['EUR 70', 70, 'EUR'],
    ['120', 120, null],
  ])('%s', (text, amount, currency) => {
    expect(parsePrice(text)).toEqual({ amount, currency });
  });

  it('is empty for blank text', () => {
    expect(parsePrice('  ')).toEqual({ amount: null, currency: null });
  });
});

describe('parseAbv', () => {
  it.each([
    ['58.3%', 58.3],
    ['58,3 %', 58.3],
    ['', null],
    ['n/a', null],
    ['158%', null],
  ])('%s', (text, expected) => {
    expect(parseAbv(text)).toBe(expected);
  });
});
