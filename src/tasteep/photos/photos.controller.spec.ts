import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { PhotosController } from './photos.controller';
import { PhotoStorageService } from './photo-storage.service';
import { signedPhotoPath } from './photo-url';

const PHOTO_ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

describe('PhotosController', () => {
  const storage = {
    exists: jest.fn(),
    path: jest.fn((id: string, size: string) => `/photos/${id}.${size}`),
  };
  const controller = new PhotosController(
    storage as unknown as PhotoStorageService,
  );

  const res = () => {
    const headers: Record<string, string> = {};
    const r = {
      headers,
      headersSent: false,
      setHeader: jest.fn((k: string, v: string) => (headers[k] = v)),
      sendFile: jest.fn(
        (_path: string, _opts: unknown, cb: (err?: Error) => void) => cb(),
      ),
    };
    return r;
  };

  const signed = (size: 'full' | 'thumb') => {
    const url = new URL(signedPhotoPath(PHOTO_ID, size), 'http://x');
    return {
      exp: url.searchParams.get('exp')!,
      sig: url.searchParams.get('sig')!,
    };
  };

  beforeEach(() => {
    process.env.TASTEEP_PHOTO_URL_SECRET = 'unit-test-photo-secret';
    storage.exists.mockReset().mockResolvedValue(true);
  });

  it('streams the file with a private cache for the life of the URL', async () => {
    const { exp, sig } = signed('thumb');
    const r = res();
    await controller.serve(
      PHOTO_ID,
      'thumb',
      exp,
      sig,
      r as unknown as Response,
    );
    expect(r.sendFile).toHaveBeenCalledWith(
      `/photos/${PHOTO_ID}.thumb`,
      expect.objectContaining({ cacheControl: false }),
      expect.any(Function),
    );
    const maxAge = Number(/max-age=(\d+)/.exec(r.headers['Cache-Control'])![1]);
    expect(maxAge).toBeGreaterThanOrEqual(24 * 60 * 60);
    expect(r.headers['Cache-Control']).toMatch(/^private, .*immutable$/);
  });

  it('403s on a bad or missing signature', async () => {
    const { exp, sig } = signed('full');
    for (const [size, e, s] of [
      ['thumb', exp, sig], // signed for another size
      ['full', exp, `${sig}x`],
      ['full', exp, undefined],
      ['full', undefined, sig],
    ] as const) {
      await expect(
        controller.serve(PHOTO_ID, size, e, s, res() as unknown as Response),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(storage.exists).not.toHaveBeenCalled();
  });

  it('404s on an unknown size or a deleted photo', async () => {
    const { exp, sig } = signed('full');
    await expect(
      controller.serve(
        PHOTO_ID,
        'huge',
        exp,
        sig,
        res() as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    storage.exists.mockResolvedValue(false);
    await expect(
      controller.serve(
        PHOTO_ID,
        'full',
        exp,
        sig,
        res() as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
