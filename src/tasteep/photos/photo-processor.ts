import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

/** Largest upload accepted, before processing (phone photos are 2–15 MB). */
export const PHOTO_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Longest edge of the stored full-size image and of the thumbnail. */
export const PHOTO_FULL_EDGE = 2048;
export const PHOTO_THUMB_EDGE = 480;

/**
 * Formats sharp's prebuilt binaries decode. HEIC (iPhone) is not among them —
 * libvips ships without the HEVC decoder — but iOS Safari converts HEIC to
 * JPEG when a web page picks a photo, and Android cameras write JPEG.
 */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

/** Refuse decompression bombs: 100 MP is well above any phone camera. */
const MAX_INPUT_PIXELS = 100_000_000;

export interface ProcessedPhoto {
  full: Buffer;
  thumb: Buffer;
}

const unsupported = () =>
  new BadRequestException('photo must be a JPEG, PNG, WebP or AVIF image.');

/**
 * Re-encodes an upload as WebP at two sizes. Orientation from EXIF is applied
 * to the pixels, then all metadata is dropped (sharp's default) — phone
 * photos carry GPS coordinates that must not end up on the server.
 */
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  const image = () =>
    sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS });

  let format: string | undefined;
  try {
    format = (await image().metadata()).format;
  } catch {
    throw unsupported();
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) throw unsupported();

  const resized = (edge: number, quality: number) =>
    image()
      .rotate()
      .resize({
        width: edge,
        height: edge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality })
      .toBuffer();

  try {
    const [full, thumb] = await Promise.all([
      resized(PHOTO_FULL_EDGE, 82),
      resized(PHOTO_THUMB_EDGE, 75),
    ]);
    return { full, thumb };
  } catch {
    // Valid header, undecodable body (truncated file, HEIC, ...).
    throw unsupported();
  }
}
