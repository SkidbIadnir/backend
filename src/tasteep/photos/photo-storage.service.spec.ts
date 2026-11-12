import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhotoStorageService } from './photo-storage.service';

const PHOTO_ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

describe('PhotoStorageService', () => {
  let dir: string;
  let storage: PhotoStorageService;
  const previous = process.env.TASTEEP_PHOTOS_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tasteep-photos-'));
    process.env.TASTEEP_PHOTOS_DIR = dir;
    storage = new PhotoStorageService();
  });

  afterEach(async () => {
    process.env.TASTEEP_PHOTOS_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });

  it('shards files by the first two characters of the id', () => {
    expect(storage.path(PHOTO_ID, 'full')).toBe(
      join(dir, '1b', `${PHOTO_ID}.webp`),
    );
    expect(storage.path(PHOTO_ID, 'thumb')).toBe(
      join(dir, '1b', `${PHOTO_ID}.thumb.webp`),
    );
  });

  it('saves both sizes and leaves no temp files behind', async () => {
    await storage.save(PHOTO_ID, {
      full: Buffer.from('full'),
      thumb: Buffer.from('thumb'),
    });
    expect(await readFile(storage.path(PHOTO_ID, 'full'), 'utf8')).toBe('full');
    expect(await readFile(storage.path(PHOTO_ID, 'thumb'), 'utf8')).toBe(
      'thumb',
    );
    expect((await readdir(join(dir, '1b'))).sort()).toEqual([
      `${PHOTO_ID}.thumb.webp`,
      `${PHOTO_ID}.webp`,
    ]);
    expect(await storage.exists(PHOTO_ID, 'full')).toBe(true);
  });

  it('removes both sizes, and tolerates files that are already gone', async () => {
    await storage.save(PHOTO_ID, {
      full: Buffer.from('a'),
      thumb: Buffer.from('b'),
    });
    await storage.remove(PHOTO_ID);
    expect(await storage.exists(PHOTO_ID, 'full')).toBe(false);
    expect(await storage.exists(PHOTO_ID, 'thumb')).toBe(false);
    await expect(storage.remove(PHOTO_ID)).resolves.toBeUndefined();
  });
});
