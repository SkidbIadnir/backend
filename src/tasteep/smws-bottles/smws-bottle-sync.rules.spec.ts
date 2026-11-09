import { KnownBottle, planSync } from './smws-bottle-sync.rules';

const url = (code: string) => `https://smws.eu/${code}`;
const bottle = (
  code: string,
  over: Partial<KnownBottle> = {},
): KnownBottle => ({
  code,
  url: url(code),
  delistedAt: null,
  consecutiveMisses: 0,
  ...over,
});
/** n available bottles `b0`…`b{n-1}`. */
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => bottle(`b${i}`));

describe('planSync', () => {
  it('trusts a complete listing on an empty table and reports every URL as unknown', () => {
    const plan = planSync([], [url('a'), url('b')], true);
    expect(plan.trusted).toBe(true);
    expect(plan.unknownUrls).toEqual([url('a'), url('b')]);
  });

  it('marks listed bottles seen and relists delisted ones', () => {
    const plan = planSync(
      [bottle('a'), bottle('b', { delistedAt: new Date() })],
      [url('a'), url('b')],
      true,
    );
    expect(plan.seen).toEqual(['a', 'b']);
    expect(plan.relisted).toEqual(['b']);
    expect(plan.missed).toEqual([]);
    expect(plan.delisted).toEqual([]);
  });

  it('gives a first miss instead of delisting after one absent run', () => {
    const known = many(10);
    const listed = known.slice(1).map((b) => b.url);
    const plan = planSync(known, listed, true);
    expect(plan.trusted).toBe(true);
    expect(plan.missed).toEqual([{ code: 'b0', misses: 1 }]);
    expect(plan.delisted).toEqual([]);
  });

  it('delists on the second trusted miss in a row', () => {
    const known = [bottle('gone', { consecutiveMisses: 1 }), ...many(9)];
    const plan = planSync(
      known,
      many(9).map((b) => b.url),
      true,
    );
    expect(plan.delisted).toEqual(['gone']);
    expect(plan.missed).toEqual([]);
  });

  it('never counts misses from an incomplete listing, but still marks seen', () => {
    const known = many(10);
    const plan = planSync(known, [known[0].url], false);
    expect(plan.trusted).toBe(false);
    expect(plan.untrustedReason).toMatch(/did not complete/);
    expect(plan.seen).toEqual(['b0']);
    expect(plan.missed).toEqual([]);
    expect(plan.delisted).toEqual([]);
  });

  it('does not trust a complete but suspiciously short listing (e.g. page 1 empty)', () => {
    const plan = planSync(many(10), [], true);
    expect(plan.trusted).toBe(false);
    expect(plan.untrustedReason).toMatch(/0 bottles for 10/);
    expect(plan.missed).toEqual([]);
    expect(plan.delisted).toEqual([]);
  });

  it('trusts a listing at exactly the ratio', () => {
    const known = many(10);
    const plan = planSync(
      known,
      known.slice(0, 8).map((b) => b.url),
      true,
    );
    expect(plan.trusted).toBe(true);
    expect(plan.missed.map((m) => m.code)).toEqual(['b8', 'b9']);
  });

  it('leaves delisted bottles alone when they stay absent', () => {
    const plan = planSync(
      [bottle('old', { delistedAt: new Date(), consecutiveMisses: 2 })],
      [url('new')],
      true,
    );
    expect(plan.missed).toEqual([]);
    expect(plan.delisted).toEqual([]);
    expect(plan.unknownUrls).toEqual([url('new')]);
  });

  it('honours custom rules', () => {
    const plan = planSync([bottle('a'), bottle('b')], [url('b')], true, {
      missesBeforeDelist: 1,
      minListedRatio: 0.5,
    });
    expect(plan.delisted).toEqual(['a']);
  });
});
