import '../src/env'; // must run before AppModule is required — see src/env.ts

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { In, Like, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TasteepFlavour } from '../src/tasteep/entities/tasteep-flavour.entity';
import { TasteepSession } from '../src/tasteep/entities/tasteep-session.entity';
import { TasteepTasting } from '../src/tasteep/entities/tasteep-tasting.entity';
import { TasteepUser } from '../src/tasteep/entities/tasteep-user.entity';
import {
  FlavourSeedFile,
  seedRows,
} from '../src/tasteep/flavours/flavour.rules';
import * as flavourData from '../src/tasteep/data/flavours.json';

/**
 * Flavours end to end against real Postgres: the boot seed, tag matching on
 * `PUT /tasteep/tastings/:id`, the reindex SQL, the unmatched queue and the
 * admin edits. Seeded rows are only read; edits go to a throw-away
 * `zz-flav-<run>` category, hard-deleted in `afterAll` with the users.
 */

jest.setTimeout(30_000);

const RUN = randomUUID().slice(0, 8);
const ADMIN_EMAIL = `e2e-flav-admin-${RUN}@tasteep.test`;
const CAT_NAME = `Zz Flav ${RUN}`;
const CAT_ID = `zz-flav-${RUN}`;
const ODD_TAG = `Zz Wax ${RUN}`;
const ODD_KEY = ODD_TAG.toLowerCase();
const enc = encodeURIComponent;

describe('Flavours (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let users: Repository<TasteepUser>;
  let sessions: Repository<TasteepSession>;
  let flavours: Repository<TasteepFlavour>;
  let tastings: Repository<TasteepTasting>;
  let admin: { id: string; token: string };
  let member: { id: string; token: string };

  const auth = (t: { token: string }) => ({
    Authorization: `Bearer ${t.token}`,
  });

  async function createUser(email: string) {
    const user = await users.save(
      users.create({
        email,
        displayName: email,
        provider: 'email',
        providerId: email,
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

  const putTasting = (id: string, tags: unknown) =>
    request(http)
      .put(`/tasteep/tastings/${id}`)
      .set(auth(member))
      .send({ name: `e2e ${RUN}`, tags });

  const flavourIdsOf = async (id: string) =>
    (await tastings.findOneByOrFail({ id })).flavourIds;

  beforeAll(async () => {
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); // same as main.ts
    await app.init(); // runs the seed
    http = app.getHttpServer();

    users = app.get(getRepositoryToken(TasteepUser));
    sessions = app.get(getRepositoryToken(TasteepSession));
    flavours = app.get(getRepositoryToken(TasteepFlavour));
    tastings = app.get(getRepositoryToken(TasteepTasting));

    admin = await createUser(ADMIN_EMAIL);
    member = await createUser(`e2e-flav-member-${RUN}@tasteep.test`);
  });

  afterAll(async () => {
    if (!app) return;
    await users.delete({ id: In([admin.id, member.id]) }); // cascades to tastings
    await flavours.delete({ id: Like(`${CAT_ID}%`) });
    delete process.env.ADMIN_EMAILS;
    await app.close();
  });

  it('seeds every flavour of the file', async () => {
    const ids = seedRows(flavourData).map((r) => r.id);
    const rows = await flavours.find({
      where: { id: In(ids) },
      withDeleted: true,
    });
    expect(rows).toHaveLength(ids.length);
  });

  it('GET /tasteep/flavours serves the tree with an ETag', async () => {
    const res = await request(http)
      .get('/tasteep/flavours')
      .set(auth(member))
      .expect(200);
    const smoky = (
      res.body as { id: string; children: { id: string }[] }[]
    ).find((c) => c.id === 'smoky');
    expect(smoky).toMatchObject({ name_en: 'Smoky', name_fr: 'Fumé' });
    expect(smoky!.children).toContainEqual({
      id: 'smoky/peat',
      name_en: 'Peat',
      name_fr: 'Tourbe',
    });

    await request(http)
      .get('/tasteep/flavours')
      .set(auth(member))
      .set('If-None-Match', res.headers.etag)
      .expect(304);
    await request(http).get('/tasteep/flavours').expect(401);
  });

  it('PUT a tasting cleans its tags and resolves flavour_ids', async () => {
    const id = randomUUID();
    const res = await putTasting(id, [
      ' Tourbé ',
      'peaty',
      'tourbe',
      'Miellé',
      ODD_TAG,
    ]).expect(200);
    expect(res.body.tags).toEqual(['Tourbé', 'peaty', 'Miellé', ODD_TAG]);
    expect(res.body.flavour_ids).toEqual(['smoky/peat', 'sweet/honey']);

    // flavour_ids is read-only: the whitelist drops it from the body.
    const again = await request(http)
      .put(`/tasteep/tastings/${randomUUID()}`)
      .set(auth(member))
      .send({ name: 'x', tags: ['floral'], flavour_ids: ['smoky'] })
      .expect(200);
    expect(again.body.flavour_ids).toEqual(['floral']);
  });

  it('PUT refuses more than 50 tags or one over 100 characters', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `t${i}`);
    await putTasting(randomUUID(), tooMany).expect(400);
    await putTasting(randomUUID(), ['x'.repeat(101)]).expect(400);
  });

  it('admin routes are for admins only', async () => {
    await request(http).get('/admin/flavours').set(auth(member)).expect(403);
  });

  describe('reindex and the unmatched queue', () => {
    const stale = randomUUID();
    const odd = randomUUID();

    beforeAll(async () => {
      // As if written before flavours existed: tags but no ids.
      await tastings.save(
        tastings.create({
          id: stale,
          userId: member.id,
          name: `e2e ${RUN}`,
          tags: ['peaty', 'Sherried'],
          flavourIds: [],
        }),
      );
      await putTasting(odd, [ODD_TAG.toUpperCase(), 'smoky']).expect(200);
    });

    it('POST /admin/flavours/reindex backfills ids without bumping updated_at', async () => {
      const before = await tastings.findOneByOrFail({ id: stale });
      const res = await request(http)
        .post('/admin/flavours/reindex')
        .set(auth(admin))
        .expect(200);
      expect(res.body.updated).toBeGreaterThanOrEqual(1);
      const after = await tastings.findOneByOrFail({ id: stale });
      expect(after.flavourIds).toEqual(['smoky/peat', 'winey/sherry']);
      expect(after.updatedAt).toEqual(before.updatedAt);
    });

    it('GET /admin/flavours/unmatched groups spellings of an unknown tag', async () => {
      const res = await request(http)
        .get('/admin/flavours/unmatched?limit=1000')
        .set(auth(admin))
        .expect(200);
      const entry = (res.body.tags as { key: string }[]).find(
        (t) => t.key === ODD_KEY,
      );
      expect(entry).toEqual({
        key: ODD_KEY,
        spellings: expect.arrayContaining([
          { tag: ODD_TAG, count: 1 },
          { tag: ODD_TAG.toUpperCase(), count: 1 },
        ]),
        tasting_count: 2,
        user_count: 1,
      });
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /admin/flavours counts tastings per flavour', async () => {
      const res = await request(http)
        .get('/admin/flavours')
        .set(auth(admin))
        .expect(200);
      const smoky = (
        res.body as {
          id: string;
          children: { id: string; tasting_count: number }[];
        }[]
      ).find((c) => c.id === 'smoky')!;
      const peat = smoky.children.find((c) => c.id === 'smoky/peat')!;
      expect(peat.tasting_count).toBeGreaterThanOrEqual(2);
    });

    it('a new category plus an alias maps the tag everywhere', async () => {
      await request(http)
        .post('/admin/flavours')
        .set(auth(admin))
        .send({ name_en: CAT_NAME, name_fr: `${CAT_NAME} fr` })
        .expect(201)
        .expect((res) => expect(res.body.id).toBe(CAT_ID));

      await request(http)
        .post(`/admin/flavours/${enc(CAT_ID)}/aliases`)
        .set(auth(admin))
        .send({ alias: ODD_TAG })
        .expect(200)
        .expect((res) => expect(res.body.aliases).toEqual([ODD_TAG]));

      expect(await flavourIdsOf(odd)).toEqual([CAT_ID, 'smoky']);
      const queue = await request(http)
        .get('/admin/flavours/unmatched?limit=1000')
        .set(auth(admin))
        .expect(200);
      expect(
        (queue.body.tags as { key: string }[]).map((t) => t.key),
      ).not.toContain(ODD_KEY);
    });

    it('refuses a key another flavour answers to', async () => {
      await request(http)
        .post(`/admin/flavours/${enc(CAT_ID)}/aliases`)
        .set(auth(admin))
        .send({ alias: 'PEATY' })
        .expect(409);
      await request(http)
        .post('/admin/flavours')
        .set(auth(admin))
        .send({ name_en: `${CAT_NAME} b`, name_fr: 'Tourbe' })
        .expect(409);
    });

    it('delete drops the id from tastings, restore brings it back', async () => {
      await request(http)
        .delete(`/admin/flavours/${enc(CAT_ID)}`)
        .set(auth(admin))
        .expect(204);
      expect(await flavourIdsOf(odd)).toEqual(['smoky']);

      await request(http)
        .post(`/admin/flavours/${enc(CAT_ID)}/restore`)
        .set(auth(admin))
        .expect(200);
      expect(await flavourIdsOf(odd)).toEqual([CAT_ID, 'smoky']);
    });

    it('export writes the table in the seed format', async () => {
      const res = await request(http)
        .get('/admin/flavours/export')
        .set(auth(admin))
        .expect(200);
      const ids = seedRows(res.body as FlavourSeedFile).map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining(['smoky/peat', CAT_ID]));
    });
  });
});
