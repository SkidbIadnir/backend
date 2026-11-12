import '../src/env'; // must run before AppModule is required — see src/env.ts

import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import sharp from 'sharp';
import request from 'supertest';
import { App } from 'supertest/types';
import { In, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TasteepSession } from '../src/tasteep/entities/tasteep-session.entity';
import { TasteepUser } from '../src/tasteep/entities/tasteep-user.entity';
import type { TastingJson } from '../src/tasteep/tastings/tasting.mapper';

/**
 * Tasting photos end to end: real multipart uploads through multer, real
 * sharp processing, files on a throw-away directory, and the signed-URL
 * route fetched without a bearer token — the way `Image.network` will.
 */

jest.setTimeout(30_000);

const RUN = randomUUID().slice(0, 8);

describe('Tasteep tasting photos (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let users: Repository<TasteepUser>;
  let sessions: Repository<TasteepSession>;
  let photosDir: string;

  let alice: { id: string; token: string };
  let bob: { id: string; token: string };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const tasting = (res: request.Response) => res.body as TastingJson;
  /** `photo_url` is absolute when APP_URL is set; supertest wants the path. */
  const pathOf = (url: string | null) => {
    const u = new URL(url!, 'http://local');
    return `${u.pathname}${u.search}`;
  };
  const photoIdOf = (url: string | null) =>
    /\/tasteep\/photos\/([0-9a-f-]{36})\//.exec(url!)![1];
  const filesOnDisk = async () => {
    const out: string[] = [];
    for (const shard of await readdir(photosDir)) {
      out.push(...(await readdir(join(photosDir, shard))));
    }
    return out.sort();
  };

  /** A 3000×2000 JPEG stored sideways with GPS in its EXIF, like a phone's. */
  let phonePhoto: Buffer;
  let pngPhoto: Buffer;

  const createTasting = (token: string, id = randomUUID()) =>
    request(http)
      .put(`/tasteep/tastings/${id}`)
      .set(auth(token))
      .send({ name: `e2e-${RUN} photo`, photo_path: '/device/a.jpg' })
      .expect(200)
      .then(() => id);

  const upload = (token: string, id: string, file: Buffer, name = 'a.jpg') =>
    request(http)
      .put(`/tasteep/tastings/${id}/photo`)
      .set(auth(token))
      .attach('photo', file, name);

  async function createUser(label: string) {
    const user = await users.save(
      users.create({
        email: `e2e-${RUN}-${label}@tasteep.test`,
        displayName: label,
        provider: 'email',
        providerId: `e2e-${RUN}-${label}@tasteep.test`,
      }),
    );
    const session = await sessions.save(
      sessions.create({
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        revokedAt: null,
        lastSeenAt: new Date(),
      }),
    );
    const token = app
      .get(JwtService)
      .sign({ sub: user.id, sid: session.id }, { expiresIn: '1h' });
    return { id: user.id, token };
  }

  beforeAll(async () => {
    photosDir = await mkdtemp(join(tmpdir(), 'tasteep-photos-e2e-'));
    process.env.TASTEEP_PHOTOS_DIR = photosDir;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .compile()
      .catch((err: Error) => {
        throw new Error(
          `Could not boot the app — is Postgres running at ${process.env.POSTGRES_HOST ?? 'localhost'}:${process.env.POSTGRES_PORT ?? 5432}? (${err.message})`,
        );
      });
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); // same as main.ts
    await app.init();
    http = app.getHttpServer();
    users = app.get(getRepositoryToken(TasteepUser));
    sessions = app.get(getRepositoryToken(TasteepSession));

    alice = await createUser('alice');
    bob = await createUser('bob');

    phonePhoto = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#842' },
    })
      .jpeg()
      .withMetadata({
        orientation: 6,
        exif: { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '55/1 38/1 0/1' } },
      })
      .toBuffer();
    pngPhoto = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#248' },
    })
      .png()
      .toBuffer();
  });

  afterAll(async () => {
    if (app) {
      await users.delete({ id: In([alice.id, bob.id]) }); // cascades sessions + tastings
      await app.close();
    }
    await rm(photosDir, { recursive: true, force: true });
  });

  it('uploads, serves without a token, and strips location metadata', async () => {
    const id = await createTasting(alice.token);
    const res = await upload(alice.token, id, phonePhoto).expect(200);

    const json = tasting(res);
    expect(json.photo_path).toBe('/device/a.jpg');
    expect(json.photo_url).toMatch(/\/full\?exp=\d+&sig=/);
    expect(json.photo_thumb_url).toMatch(/\/thumb\?exp=\d+&sig=/);

    const full = await request(http)
      .get(pathOf(json.photo_url))
      .buffer(true)
      .expect(200)
      .expect('Content-Type', 'image/webp')
      .expect('Cache-Control', /^private, max-age=\d+, immutable$/);
    const meta = await sharp(full.body as Buffer).metadata();
    // EXIF orientation 6 applied: the sideways landscape is now portrait.
    expect(meta).toMatchObject({ format: 'webp', width: 1365, height: 2048 });
    expect(meta.exif).toBeUndefined();

    const thumb = await request(http)
      .get(pathOf(json.photo_thumb_url))
      .buffer(true)
      .expect(200);
    expect((await sharp(thumb.body as Buffer).metadata()).height).toBe(480);

    // Listed and fetched tastings carry the same URLs.
    const listed = await request(http)
      .get('/tasteep/tastings')
      .set(auth(alice.token))
      .expect(200);
    expect(
      (listed.body as TastingJson[]).find((t) => t.id === id)?.photo_url,
    ).toBe(json.photo_url);
  });

  it('rejects tampered, cross-size and unsigned photo URLs with 403', async () => {
    const id = await createTasting(alice.token);
    const json = tasting(await upload(alice.token, id, pngPhoto).expect(200));
    const full = pathOf(json.photo_url);

    await request(http).get(`${full}x`).expect(403);
    await request(http).get(full.replace('/full?', '/thumb?')).expect(403);
    await request(http).get(full.split('?')[0]).expect(403);
    await request(http).get(full.replace('/full?', '/huge?')).expect(404);
  });

  it('keeps the photo across a full PUT of the tasting', async () => {
    const id = await createTasting(alice.token);
    const json = tasting(await upload(alice.token, id, pngPhoto).expect(200));
    const res = await request(http)
      .put(`/tasteep/tastings/${id}`)
      .set(auth(alice.token))
      .send({ name: 'renamed', photo_path: null })
      .expect(200);
    expect(tasting(res).photo_url).toBe(json.photo_url);
  });

  it('replaces a photo under a new id and deletes the old files', async () => {
    const id = await createTasting(alice.token);
    const first = tasting(await upload(alice.token, id, pngPhoto).expect(200));
    const second = tasting(
      await upload(alice.token, id, phonePhoto).expect(200),
    );

    expect(photoIdOf(second.photo_url)).not.toBe(photoIdOf(first.photo_url));
    await request(http).get(pathOf(first.photo_url)).expect(404);
    await request(http).get(pathOf(second.photo_url)).expect(200);
    expect(
      (await filesOnDisk()).filter((f) =>
        f.startsWith(photoIdOf(first.photo_url)),
      ),
    ).toEqual([]);
  });

  it('DELETE …/photo detaches it and deletes the files', async () => {
    const id = await createTasting(alice.token);
    const json = tasting(await upload(alice.token, id, pngPhoto).expect(200));
    const photoId = photoIdOf(json.photo_url);

    const res = await request(http)
      .delete(`/tasteep/tastings/${id}/photo`)
      .set(auth(alice.token))
      .expect(200);
    expect(tasting(res)).toMatchObject({
      photo_url: null,
      photo_thumb_url: null,
    });
    expect((await filesOnDisk()).some((f) => f.startsWith(photoId))).toBe(
      false,
    );
    await request(http).get(pathOf(json.photo_url)).expect(404);
  });

  it('deleting the tasting deletes its photo files', async () => {
    const id = await createTasting(alice.token);
    const json = tasting(await upload(alice.token, id, pngPhoto).expect(200));
    const photoId = photoIdOf(json.photo_url);
    expect((await filesOnDisk()).filter((f) => f.startsWith(photoId))).toEqual([
      `${photoId}.thumb.webp`,
      `${photoId}.webp`,
    ]);

    await request(http)
      .delete(`/tasteep/tastings/${id}`)
      .set(auth(alice.token))
      .expect(204);
    expect((await filesOnDisk()).some((f) => f.startsWith(photoId))).toBe(
      false,
    );
  });

  describe('rejections', () => {
    let id: string;
    beforeAll(async () => {
      id = await createTasting(alice.token);
    });

    it('401 without a token', () =>
      request(http)
        .put(`/tasteep/tastings/${id}/photo`)
        .attach('photo', pngPhoto, 'a.png')
        .expect(401));

    it("404 on another user's tasting, and on one that does not exist yet", async () => {
      await upload(bob.token, id, pngPhoto).expect(404);
      await upload(alice.token, randomUUID(), pngPhoto).expect(404);
    });

    it('400 without a file, or with a file that is not an image', async () => {
      await request(http)
        .put(`/tasteep/tastings/${id}/photo`)
        .set(auth(alice.token))
        .send({})
        .expect(400);
      await upload(
        alice.token,
        id,
        Buffer.from('%PDF-1.7 nope'),
        'a.pdf',
      ).expect(400);
    });

    it('413 above 20 MB', () =>
      upload(alice.token, id, Buffer.alloc(20 * 1024 * 1024 + 1)).expect(413));

    it('leaves no files behind for rejected uploads', async () => {
      const res = await request(http)
        .get(`/tasteep/tastings/${id}`)
        .set(auth(alice.token))
        .expect(200);
      expect(tasting(res).photo_url).toBeNull();
      expect((await filesOnDisk()).some((f) => f.endsWith('.tmp'))).toBe(false);
    });
  });
});
