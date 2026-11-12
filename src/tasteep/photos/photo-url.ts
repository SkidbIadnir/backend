import { createHmac, timingSafeEqual } from 'node:crypto';
import { tasteepConfig } from '../tasteep-config';

export const PHOTO_SIZES = ['full', 'thumb'] as const;
export type PhotoSize = (typeof PHOTO_SIZES)[number];

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Photo URLs carry an HMAC instead of requiring the bearer token, so a plain
 * `Image.network(url)` works on Android and on Flutter web alike.
 *
 * The expiry is snapped to a day boundary: every URL issued on the same UTC
 * day is identical (so HTTP caches keep hitting) and stays valid for at least
 * 24 h, at most 48 h. A client holding an expired URL re-fetches the tasting.
 */
export function photoUrlExpiry(nowMs: number = Date.now()): number {
  const today = Math.floor(nowMs / 1000 / DAY_SECONDS) * DAY_SECONDS;
  return today + 2 * DAY_SECONDS;
}

function signingKey(): string {
  const explicit = tasteepConfig.photoUrlSecret;
  if (explicit) return explicit;
  const jwtSecret = tasteepConfig.jwtSecret;
  if (!jwtSecret) {
    throw new Error(
      'Set TASTEEP_PHOTO_URL_SECRET or TASTEEP_JWT_SECRET to sign photo URLs.',
    );
  }
  return createHmac('sha256', jwtSecret)
    .update('tasteep-photo-urls')
    .digest('hex');
}

function signature(photoId: string, size: PhotoSize, exp: number): string {
  return createHmac('sha256', signingKey())
    .update(`${photoId}/${size}/${exp}`)
    .digest('base64url');
}

/** Path + query of a signed photo URL (no host). */
export function signedPhotoPath(
  photoId: string,
  size: PhotoSize,
  nowMs: number = Date.now(),
): string {
  const exp = photoUrlExpiry(nowMs);
  const sig = signature(photoId, size, exp);
  return `/tasteep/photos/${photoId}/${size}?exp=${exp}&sig=${sig}`;
}

/** Absolute URL when `APP_URL` is set, otherwise the bare path. */
export function signedPhotoUrl(
  photoId: string,
  size: PhotoSize,
  nowMs: number = Date.now(),
): string {
  return `${tasteepConfig.appUrl}${signedPhotoPath(photoId, size, nowMs)}`;
}

export function verifyPhotoSignature(
  photoId: string,
  size: PhotoSize,
  exp: number,
  sig: string,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isSafeInteger(exp) || exp * 1000 <= nowMs) return false;
  const expected = Buffer.from(signature(photoId, size, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
