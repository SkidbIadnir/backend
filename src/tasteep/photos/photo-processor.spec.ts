import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import {
  PHOTO_FULL_EDGE,
  PHOTO_THUMB_EDGE,
  processPhoto,
} from './photo-processor';

const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#7a3' } });

describe('processPhoto', () => {
  it('re-encodes as WebP and caps both sizes, keeping the aspect ratio', async () => {
    const input = await image(4000, 3000).jpeg().toBuffer();
    const { full, thumb } = await processPhoto(input);

    const f = await sharp(full).metadata();
    const t = await sharp(thumb).metadata();
    expect(f).toMatchObject({
      format: 'webp',
      width: PHOTO_FULL_EDGE,
      height: 1536,
    });
    expect(t).toMatchObject({
      format: 'webp',
      width: PHOTO_THUMB_EDGE,
      height: 360,
    });
  });

  it('never enlarges a small image', async () => {
    const { full, thumb } = await processPhoto(
      await image(300, 200).png().toBuffer(),
    );
    expect((await sharp(full).metadata()).width).toBe(300);
    expect((await sharp(thumb).metadata()).width).toBe(300);
  });

  it('applies EXIF orientation, then strips all metadata (GPS included)', async () => {
    const input = await image(400, 200)
      .jpeg()
      .withMetadata({
        orientation: 6, // stored landscape, displayed rotated 90°
        exif: { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '55/1 38/1 0/1' } },
      })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const { full } = await processPhoto(input);
    const meta = await sharp(full).metadata();
    expect(meta).toMatchObject({ width: 200, height: 400 });
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it.each([
    ['plain text', Buffer.from('definitely not an image')],
    ['an empty buffer', Buffer.alloc(0)],
    [
      'an SVG',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      ),
    ],
  ])('rejects %s with 400', async (_label, input) => {
    await expect(processPhoto(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a truncated JPEG with 400', async () => {
    const input = await image(800, 600).jpeg().toBuffer();
    await expect(
      processPhoto(input.subarray(0, input.length / 2)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
