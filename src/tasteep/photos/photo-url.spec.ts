import {
  photoUrlExpiry,
  signedPhotoPath,
  verifyPhotoSignature,
} from './photo-url';

const PHOTO_ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const NOW = Date.parse('2026-11-12T15:30:00Z');
const DAY = 24 * 60 * 60;

const parse = (path: string) => {
  const url = new URL(path, 'http://x');
  return {
    exp: Number(url.searchParams.get('exp')),
    sig: url.searchParams.get('sig')!,
  };
};

describe('photo-url', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.TASTEEP_PHOTO_URL_SECRET = 'unit-test-photo-secret';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('expires two day boundaries ahead, so URLs are stable within a UTC day', () => {
    const exp = photoUrlExpiry(NOW);
    expect(exp).toBe(Date.parse('2026-11-14T00:00:00Z') / 1000);
    expect(photoUrlExpiry(Date.parse('2026-11-12T00:00:01Z'))).toBe(exp);
    expect(photoUrlExpiry(Date.parse('2026-11-12T23:59:59Z'))).toBe(exp);
    expect(exp - NOW / 1000).toBeGreaterThanOrEqual(DAY);
  });

  it('builds the same URL all day long', () => {
    expect(signedPhotoPath(PHOTO_ID, 'full', NOW)).toBe(
      signedPhotoPath(PHOTO_ID, 'full', NOW + 60 * 60 * 1000),
    );
  });

  it('accepts its own signature until the expiry', () => {
    const { exp, sig } = parse(signedPhotoPath(PHOTO_ID, 'thumb', NOW));
    expect(verifyPhotoSignature(PHOTO_ID, 'thumb', exp, sig, NOW)).toBe(true);
    expect(
      verifyPhotoSignature(PHOTO_ID, 'thumb', exp, sig, exp * 1000 - 1),
    ).toBe(true);
    expect(verifyPhotoSignature(PHOTO_ID, 'thumb', exp, sig, exp * 1000)).toBe(
      false,
    );
  });

  it('binds the signature to the photo, the size and the expiry', () => {
    const { exp, sig } = parse(signedPhotoPath(PHOTO_ID, 'thumb', NOW));
    const other = '2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    expect(verifyPhotoSignature(other, 'thumb', exp, sig, NOW)).toBe(false);
    expect(verifyPhotoSignature(PHOTO_ID, 'full', exp, sig, NOW)).toBe(false);
    expect(verifyPhotoSignature(PHOTO_ID, 'thumb', exp + DAY, sig, NOW)).toBe(
      false,
    );
    expect(verifyPhotoSignature(PHOTO_ID, 'thumb', exp, 'nope', NOW)).toBe(
      false,
    );
    expect(verifyPhotoSignature(PHOTO_ID, 'thumb', NaN, sig, NOW)).toBe(false);
  });

  it('stops verifying when the secret changes', () => {
    const { exp, sig } = parse(signedPhotoPath(PHOTO_ID, 'full', NOW));
    process.env.TASTEEP_PHOTO_URL_SECRET = 'rotated';
    expect(verifyPhotoSignature(PHOTO_ID, 'full', exp, sig, NOW)).toBe(false);
  });

  it('derives a key from the JWT secret when no photo secret is set', () => {
    delete process.env.TASTEEP_PHOTO_URL_SECRET;
    process.env.TASTEEP_JWT_SECRET = 'jwt-secret';
    const { exp, sig } = parse(signedPhotoPath(PHOTO_ID, 'full', NOW));
    expect(verifyPhotoSignature(PHOTO_ID, 'full', exp, sig, NOW)).toBe(true);
  });
});
