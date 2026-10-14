import '../src/env'; // must run before AppModule is required — see src/env.ts

import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { In, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TasteepSession } from '../src/tasteep/entities/tasteep-session.entity';
import { TasteepTasting } from '../src/tasteep/entities/tasteep-tasting.entity';
import { TasteepUser } from '../src/tasteep/entities/tasteep-user.entity';
import { TasteepWishlistFolder } from '../src/tasteep/entities/tasteep-wishlist-folder.entity';
import { TasteepWishlistItem } from '../src/tasteep/entities/tasteep-wishlist-item.entity';
import type {
  WishlistFolderJson,
  WishlistItemJson,
} from '../src/tasteep/wishlist/wishlist.mapper';

/**
 * Wish List, end to end: real Nest app, real Postgres (the one `.env`
 * points at), real JWT guard and validation pipe.
 *
 * Every row this suite creates is scoped to two throw-away users that are
 * deleted in `afterAll` (folders, items and sessions cascade).
 */

jest.setTimeout(30_000);

const RUN = randomUUID().slice(0, 8);

const FOLDER_KEYS = ['id', 'name', 'sort_order', 'created_at', 'updated_at'].sort();
const ITEM_KEYS = [
  'id',
  'folder_id',
  'name',
  'distillery',
  'region',
  'region_id',
  'category',
  'target_price',
  'why_i_want',
  'where_to_buy',
  'fulfilled_tasting_id',
  'fulfilled',
  'created_at',
  'updated_at',
].sort();

describe('Tasteep wish list (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let users: Repository<TasteepUser>;
  let sessions: Repository<TasteepSession>;
  let folders: Repository<TasteepWishlistFolder>;
  let items: Repository<TasteepWishlistItem>;
  let tastings: Repository<TasteepTasting>;

  let alice: { id: string; token: string };
  let bob: { id: string; token: string };

  const nextPurchase = randomUUID();
  const someday = randomUUID();
  const springbank = randomUUID();
  const karuizawa = randomUUID();
  const bobsFolder = randomUUID();
  const bobsItem = randomUUID();
  const loggedTasting = randomUUID();

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const folder = (res: request.Response) => res.body as WishlistFolderJson;
  const folderList = (res: request.Response) => res.body as WishlistFolderJson[];
  const item = (res: request.Response) => res.body as WishlistItemJson;
  const itemList = (res: request.Response) => res.body as WishlistItemJson[];
  const errorMessage = (res: request.Response) =>
    (res.body as { message: string | string[] }).message;

  const folderBody = (over: Record<string, unknown> = {}) => ({
    name: `${RUN} Next Purchase`,
    sort_order: 0,
    ...over,
  });

  const itemBody = (over: Record<string, unknown> = {}) => ({
    name: 'Springbank 15',
    folder_id: nextPurchase,
    distillery: 'Springbank',
    region: 'Campbeltown',
    region_id: null,
    category: 'whisky',
    target_price: 98,
    why_i_want: 'Tasted the 12 at the Society bar.',
    where_to_buy: 'Royal Mile Whiskies, Edinburgh',
    fulfilled_tasting_id: null,
    ...over,
  });

  async function createUser(
    label: string,
  ): Promise<{ id: string; token: string }> {
    const user = await users.save(
      users.create({
        email: `e2e-wishlist-${RUN}-${label}@tasteep.test`,
        displayName: label,
        provider: 'email',
        providerId: `e2e-wishlist-${RUN}-${label}@tasteep.test`,
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
    let moduleRef: TestingModule;
    try {
      moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
    } catch (err) {
      throw new Error(
        `Could not boot the app — is Postgres running at ${process.env.POSTGRES_HOST ?? 'localhost'}:${process.env.POSTGRES_PORT ?? 5432}? (${(err as Error).message})`,
      );
    }
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); // same as main.ts
    await app.init();
    http = app.getHttpServer();

    users = app.get(getRepositoryToken(TasteepUser));
    sessions = app.get(getRepositoryToken(TasteepSession));
    folders = app.get(getRepositoryToken(TasteepWishlistFolder));
    items = app.get(getRepositoryToken(TasteepWishlistItem));
    tastings = app.get(getRepositoryToken(TasteepTasting));

    alice = await createUser('alice');
    bob = await createUser('bob');
  });

  afterAll(async () => {
    if (!app) return;
    await users.delete({ id: In([alice.id, bob.id]) }); // cascades sessions + folders + items
    await app.close();
  });

  // ---------------------------------------------------------------------------

  describe('auth gate', () => {
    it.each([
      ['get', '/tasteep/wishlist/folders'],
      ['get', '/tasteep/wishlist/items'],
    ] as const)('%s %s → 401 without a bearer token', async (method, url) => {
      await request(http)[method](url).expect(401);
    });
  });

  describe('folders', () => {
    it('creates a folder with the exact client contract', async () => {
      const res = await request(http)
        .put(`/tasteep/wishlist/folders/${nextPurchase}`)
        .set(auth(alice.token))
        .send(folderBody())
        .expect(200);
      expect(Object.keys(folder(res)).sort()).toEqual(FOLDER_KEYS);
      expect(folder(res)).toMatchObject({
        id: nextPurchase,
        name: `${RUN} Next Purchase`,
        sort_order: 0,
      });

      await request(http)
        .put(`/tasteep/wishlist/folders/${someday}`)
        .set(auth(alice.token))
        .send(folderBody({ name: `${RUN} Someday`, sort_order: 1 }))
        .expect(200);

      await request(http)
        .put(`/tasteep/wishlist/folders/${bobsFolder}`)
        .set(auth(bob.token))
        .send(folderBody({ name: `${RUN} Bob's folder` }))
        .expect(200);
    });

    it('rejects a non-UUID id and an invalid body', async () => {
      await request(http)
        .put('/tasteep/wishlist/folders/not-a-uuid')
        .set(auth(alice.token))
        .send(folderBody())
        .expect(400);
      await request(http)
        .put(`/tasteep/wishlist/folders/${randomUUID()}`)
        .set(auth(alice.token))
        .send(folderBody({ name: '' }))
        .expect(400);
    });

    it('409s when the id belongs to another account', async () => {
      await request(http)
        .put(`/tasteep/wishlist/folders/${nextPurchase}`)
        .set(auth(bob.token))
        .send(folderBody())
        .expect(409);
    });

    it('lists only my folders, ordered by sort_order', async () => {
      const res = await request(http)
        .get('/tasteep/wishlist/folders')
        .set(auth(alice.token))
        .expect(200);
      const mine = folderList(res).filter((f) => f.name.startsWith(RUN));
      expect(mine.map((f) => f.id)).toEqual([nextPurchase, someday]);
    });

    it("never shows another user's folder", async () => {
      await request(http)
        .get(`/tasteep/wishlist/folders/${bobsFolder}`)
        .set(auth(alice.token))
        .expect(404);
    });
  });

  describe('items', () => {
    it('creates an item filed into a folder, resolving the region', async () => {
      const res = await request(http)
        .put(`/tasteep/wishlist/items/${springbank}`)
        .set(auth(alice.token))
        .send(itemBody())
        .expect(200);
      expect(Object.keys(item(res)).sort()).toEqual(ITEM_KEYS);
      expect(item(res)).toMatchObject({
        id: springbank,
        folder_id: nextPurchase,
        name: 'Springbank 15',
        target_price: 98,
        category: 'whisky',
        fulfilled: false,
        fulfilled_tasting_id: null,
        region: 'Campbeltown',
        region_id: 'scotland/campbeltown',
      });

      await request(http)
        .put(`/tasteep/wishlist/items/${karuizawa}`)
        .set(auth(alice.token))
        .send(
          itemBody({
            name: 'Karuizawa 1981',
            folder_id: someday,
            distillery: 'Karuizawa',
            region: null,
            target_price: 520,
          }),
        )
        .expect(200);

      await request(http)
        .put(`/tasteep/wishlist/items/${bobsItem}`)
        .set(auth(bob.token))
        .send(itemBody({ folder_id: null }))
        .expect(200);
    });

    it('accepts a wider category than the tasting journal (gin, cognac)', async () => {
      const res = await request(http)
        .put(`/tasteep/wishlist/items/${randomUUID()}`)
        .set(auth(alice.token))
        .send(itemBody({ name: 'Tanqueray Malacca', folder_id: null, category: 'gin' }))
        .expect(200);
      expect(item(res).category).toBe('gin');

      await request(http)
        .put(`/tasteep/wishlist/items/${randomUUID()}`)
        .set(auth(alice.token))
        .send(itemBody({ name: 'x', folder_id: null, category: 'sherry' }))
        .expect(400);
    });

    it('rejects a folder_id that is not mine', async () => {
      const res = await request(http)
        .put(`/tasteep/wishlist/items/${randomUUID()}`)
        .set(auth(alice.token))
        .send(itemBody({ folder_id: bobsFolder }))
        .expect(400);
      expect(errorMessage(res)).toMatch(/folder_id/);
    });

    it('409s when the id belongs to another account', async () => {
      await request(http)
        .put(`/tasteep/wishlist/items/${springbank}`)
        .set(auth(bob.token))
        .send(itemBody())
        .expect(409);
    });

    it('lists only my items, and filters by folder_id / unfiled', async () => {
      const mine = await request(http)
        .get('/tasteep/wishlist/items')
        .set(auth(alice.token))
        .expect(200);
      expect(itemList(mine).map((i) => i.id)).toEqual(
        expect.arrayContaining([springbank, karuizawa]),
      );
      expect(itemList(mine).map((i) => i.id)).not.toContain(bobsItem);

      const filtered = await request(http)
        .get(`/tasteep/wishlist/items?folder_id=${nextPurchase}`)
        .set(auth(alice.token))
        .expect(200);
      expect(itemList(filtered).map((i) => i.id)).toEqual([springbank]);
    });
  });

  describe('log a tasting', () => {
    it('links a tasting owned by the same user and reports fulfilled: true', async () => {
      await request(http)
        .put(`/tasteep/tastings/${loggedTasting}`)
        .set(auth(alice.token))
        .send({ name: 'Springbank 15', category: 'whisky' })
        .expect(200);

      const res = await request(http)
        .put(`/tasteep/wishlist/items/${springbank}`)
        .set(auth(alice.token))
        .send(itemBody({ fulfilled_tasting_id: loggedTasting }))
        .expect(200);
      expect(res.body).toMatchObject({
        fulfilled: true,
        fulfilled_tasting_id: loggedTasting,
      });
    });

    it("rejects a fulfilled_tasting_id that is not mine", async () => {
      const bobsTasting = randomUUID();
      await request(http)
        .put(`/tasteep/tastings/${bobsTasting}`)
        .set(auth(bob.token))
        .send({ name: "Bob's dram", category: 'whisky' })
        .expect(200);

      const res = await request(http)
        .put(`/tasteep/wishlist/items/${karuizawa}`)
        .set(auth(alice.token))
        .send(itemBody({ fulfilled_tasting_id: bobsTasting, folder_id: someday }))
        .expect(400);
      expect(errorMessage(res)).toMatch(/fulfilled_tasting_id/);

      await tastings.delete({ id: bobsTasting });
    });
  });

  describe('DELETE /tasteep/wishlist/folders/:id', () => {
    it("unfiles the folder's items instead of deleting them", async () => {
      await request(http)
        .delete(`/tasteep/wishlist/folders/${nextPurchase}`)
        .set(auth(alice.token))
        .expect(204);

      const res = await request(http)
        .get(`/tasteep/wishlist/items/${springbank}`)
        .set(auth(alice.token))
        .expect(200);
      expect(item(res)).toMatchObject({ id: springbank, folder_id: null });

      const row = await items.findOneByOrFail({ id: springbank });
      expect(row.folderId).toBeNull();
    });

    it("404s on another user's folder, and again on a second delete", async () => {
      await request(http)
        .delete(`/tasteep/wishlist/folders/${bobsFolder}`)
        .set(auth(alice.token))
        .expect(404);
      await request(http)
        .delete(`/tasteep/wishlist/folders/${someday}`)
        .set(auth(alice.token))
        .expect(204);
      await request(http)
        .delete(`/tasteep/wishlist/folders/${someday}`)
        .set(auth(alice.token))
        .expect(404);
    });
  });

  describe('DELETE /tasteep/wishlist/items/:id', () => {
    it("404s on another user's item, 204 on mine", async () => {
      await request(http)
        .delete(`/tasteep/wishlist/items/${bobsItem}`)
        .set(auth(alice.token))
        .expect(404);
      await request(http)
        .delete(`/tasteep/wishlist/items/${springbank}`)
        .set(auth(alice.token))
        .expect(204);
      await request(http)
        .get(`/tasteep/wishlist/items/${springbank}`)
        .set(auth(alice.token))
        .expect(404);
    });
  });
});
