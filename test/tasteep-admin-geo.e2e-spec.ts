/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment --
   supertest types `res.body` as `any`; the assertions below are the typing. */
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
import { TasteepDistilleryLocation } from '../src/tasteep/entities/tasteep-distillery-location.entity';
import { TasteepGeocodeCache } from '../src/tasteep/entities/tasteep-geocode-cache.entity';
import { TasteepRegion } from '../src/tasteep/entities/tasteep-region.entity';
import { TasteepSession } from '../src/tasteep/entities/tasteep-session.entity';
import { TasteepTasting } from '../src/tasteep/entities/tasteep-tasting.entity';
import { TasteepUser } from '../src/tasteep/entities/tasteep-user.entity';
import {
  DistillerySeedFile,
  seedRows as distillerySeedRows,
} from '../src/tasteep/geocode/distillery-locations.service';
import {
  RegionSeedFile,
  RegionsService,
  seedRows as regionSeedRows,
} from '../src/tasteep/regions/regions.service';
import * as distilleryData from '../src/tasteep/data/distillery-location.json';
import * as regionData from '../src/tasteep/data/region.json';

/**
 * `/admin/distillery-locations` and `/admin/regions`, end to end against real
 * Postgres: the insert-missing seed, geocode cache eviction, apply, soft
 * delete / restore, aliases and reorder. Seeded rows are only read; every
 * write goes to throw-away `zz-e2e-<run>` / `zz-land-<run>` rows, hard-deleted
 * in `afterAll`.
 */

jest.setTimeout(30_000);

const RUN = randomUUID().slice(0, 8);
const ADMIN_EMAIL = `e2e-geo-admin-${RUN}@tasteep.test`;
const DIST = `Zz E2E ${RUN}`;
const DIST_ID = `zz-e2e-${RUN}`;
const DIST_KEY = DIST.toLowerCase();
const LAND = `Zz Land ${RUN}`;
const LAND_ID = `zz-land-${RUN}`;
const enc = encodeURIComponent;

describe('Admin distillery locations and regions (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let users: Repository<TasteepUser>;
  let sessions: Repository<TasteepSession>;
  let locations: Repository<TasteepDistilleryLocation>;
  let cache: Repository<TasteepGeocodeCache>;
  let regions: Repository<TasteepRegion>;
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

  const tasting = (over: Partial<TasteepTasting>) =>
    tastings.save(
      tastings.create({
        id: randomUUID(),
        userId: member.id,
        name: `e2e ${RUN}`,
        category: 'whisky',
        ...over,
      }),
    );

  const miss = (query: string) =>
    cache.save(
      cache.create({ query, lat: null, lon: null, precision: 'unknown' }),
    );

  beforeAll(async () => {
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); // same as main.ts
    await app.init(); // runs the seeds
    http = app.getHttpServer();

    users = app.get(getRepositoryToken(TasteepUser));
    sessions = app.get(getRepositoryToken(TasteepSession));
    locations = app.get(getRepositoryToken(TasteepDistilleryLocation));
    cache = app.get(getRepositoryToken(TasteepGeocodeCache));
    regions = app.get(getRepositoryToken(TasteepRegion));
    tastings = app.get(getRepositoryToken(TasteepTasting));

    admin = await createUser(ADMIN_EMAIL);
    member = await createUser(`e2e-geo-member-${RUN}@tasteep.test`);
  });

  afterAll(async () => {
    if (!app) return;
    await locations.delete({ id: Like(`${DIST_ID}%`) });
    await cache.delete({ query: Like(`${DIST_KEY}%`) });
    await users.delete({ id: In([admin.id, member.id]) }); // cascades to tastings
    await regions.delete({ parentId: LAND_ID });
    await regions.delete({ id: LAND_ID });
    delete process.env.ADMIN_EMAILS;
    await app.close();
  });

  describe('seeds', () => {
    it('put every distillery and region from the files in the tables', async () => {
      const distIds = new Set(
        (await locations.find({ withDeleted: true })).map((r) => r.id),
      );
      expect(
        distillerySeedRows(distilleryData as DistillerySeedFile).filter(
          (r) => !distIds.has(r.id),
        ),
      ).toEqual([]);
      const regionIds = new Set(
        (await regions.find({ withDeleted: true })).map((r) => r.id),
      );
      expect(
        regionSeedRows(regionData as RegionSeedFile).filter(
          (r) => !regionIds.has(r.id),
        ),
      ).toEqual([]);
    });

    it('moved the hard-coded aliases into the table', async () => {
      const us = await regions.findOneByOrFail({ id: 'united-states' });
      expect(us.aliases).toEqual(expect.arrayContaining(['USA']));
    });
  });

  describe('/admin/distillery-locations', () => {
    it('403s a non-admin', async () => {
      await request(http)
        .get('/admin/distillery-locations')
        .set(auth(member))
        .expect(403);
    });

    it('validates the create body', async () => {
      await request(http)
        .post('/admin/distillery-locations')
        .set(auth(admin))
        .send({ name: DIST, lat: 91, lon: 0, precision: 'exact' })
        .expect(400);
      await request(http)
        .post('/admin/distillery-locations')
        .set(auth(admin))
        .send({ name: DIST, lat: 1, lon: 2, precision: 'manual' })
        .expect(400);
    });

    it('create clears the cached misses the name matches, so geocoding finds it', async () => {
      await miss(DIST_KEY);
      await miss(`${DIST_KEY}, islay`);
      await miss(`${DIST_KEY}x`); // a different word: stays cached

      const res = await request(http)
        .post('/admin/distillery-locations')
        .set(auth(admin))
        .send({ name: DIST, lat: 55.9, lon: -5.9, precision: 'exact' })
        .expect(201);
      expect(res.body).toMatchObject({
        id: DIST_ID,
        name: DIST,
        precision: 'exact',
        deleted_at: null,
        cache_cleared: 2,
      });
      expect(await cache.existsBy({ query: `${DIST_KEY}x` })).toBe(true);

      const geo = await request(http)
        .post('/tasteep/geocode')
        .set(auth(member))
        .send({ query: `${DIST} · Islay` })
        .expect(200);
      expect(geo.body).toEqual({ lat: 55.9, lon: -5.9, precision: 'exact' });

      await request(http)
        .post('/admin/distillery-locations')
        .set(auth(admin))
        .send({ name: DIST, lat: 1, lon: 2, precision: 'exact' })
        .expect(409);
    });

    it('lists with a search', async () => {
      const res = await request(http)
        .get(`/admin/distillery-locations?q=${enc(RUN)}`)
        .set(auth(admin))
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].id).toBe(DIST_ID);
    });

    it('patch keeps the id and evicts the cached curated hit', async () => {
      const res = await request(http)
        .patch(`/admin/distillery-locations/${DIST_ID}`)
        .set(auth(admin))
        .send({ name: `${DIST} Old`, lat: 56 })
        .expect(200);
      expect(res.body).toMatchObject({
        id: DIST_ID,
        name: `${DIST} Old`,
        lat: 56,
        lon: -5.9,
        cache_cleared: 1, // "<dist> · islay", cached as curated above
      });
      await request(http)
        .patch(`/admin/distillery-locations/${DIST_ID}`)
        .set(auth(admin))
        .send({ name: DIST })
        .expect(200);
      await request(http)
        .patch(`/admin/distillery-locations/${DIST_ID}`)
        .set(auth(admin))
        .send({ name: null })
        .expect(400);
    });

    it('the longest matching name wins', async () => {
      await request(http)
        .post('/admin/distillery-locations')
        .set(auth(admin))
        .send({ name: `${DIST} Scotia`, lat: 10, lon: 20, precision: 'region' })
        .expect(201);
      const geo = await request(http)
        .post('/tasteep/geocode')
        .set(auth(member))
        .send({ query: `${DIST} Scotia, Campbeltown` })
        .expect(200);
      expect(geo.body).toEqual({ lat: 10, lon: 20, precision: 'region' });
    });

    it('apply places unplaced tastings it matches best, never manual pins', async () => {
      const unplaced = await tasting({ distillery: `  ${DIST}  ` });
      const country = await tasting({
        distillery: DIST,
        lat: 1,
        lon: 1,
        locationPrecision: 'country',
      });
      const longer = await tasting({ distillery: `${DIST} Scotia` });
      const manual = await tasting({
        distillery: DIST,
        lat: 2,
        lon: 2,
        locationPrecision: 'manual',
      });
      const placed = await tasting({
        distillery: DIST,
        lat: 3,
        lon: 3,
        locationPrecision: 'exact',
      });

      const res = await request(http)
        .post(`/admin/distillery-locations/${DIST_ID}/apply`)
        .set(auth(admin))
        .expect(200);
      expect(res.body).toEqual({ id: DIST_ID, updated: 2 });

      const byId = new Map(
        (
          await tastings.findBy({
            id: In([unplaced.id, country.id, longer.id, manual.id, placed.id]),
          })
        ).map((t) => [t.id, t]),
      );
      for (const t of [unplaced, country]) {
        expect(byId.get(t.id)).toMatchObject({
          lat: 56,
          lon: -5.9,
          locationPrecision: 'exact',
        });
      }
      expect(byId.get(longer.id)?.locationPrecision).toBe('unknown');
      expect(byId.get(manual.id)).toMatchObject({
        lat: 2,
        locationPrecision: 'manual',
      });
      expect(byId.get(placed.id)?.lat).toBe(3);
    });

    it('delete is soft, and create or restore brings the row back', async () => {
      const del = await request(http)
        .delete(`/admin/distillery-locations/${DIST_ID}`)
        .set(auth(admin))
        .expect(200);
      expect(del.body.cache_cleared).toBeGreaterThanOrEqual(1);

      const live = await request(http)
        .get(`/admin/distillery-locations?q=${enc(RUN)}`)
        .set(auth(admin))
        .expect(200);
      expect(live.body.items.map((i: { id: string }) => i.id)).toEqual([
        `${DIST_ID}-scotia`,
      ]);
      const all = await request(http)
        .get(`/admin/distillery-locations?q=${enc(RUN)}&include_deleted=true`)
        .set(auth(admin))
        .expect(200);
      expect(
        all.body.items.find((i: { id: string }) => i.id === DIST_ID).deleted_at,
      ).not.toBeNull();

      await request(http)
        .patch(`/admin/distillery-locations/${DIST_ID}`)
        .set(auth(admin))
        .send({ lat: 1 })
        .expect(404);

      const restored = await request(http)
        .post(`/admin/distillery-locations/${DIST_ID}/restore`)
        .set(auth(admin))
        .expect(200);
      expect(restored.body).toMatchObject({ id: DIST_ID, deleted_at: null });

      await request(http)
        .delete(`/admin/distillery-locations/${DIST_ID}`)
        .set(auth(admin))
        .expect(200);
      const recreated = await request(http)
        .post('/admin/distillery-locations')
        .set(auth(admin))
        .send({ name: DIST, lat: 7, lon: 8, precision: 'country' })
        .expect(201);
      expect(recreated.body).toMatchObject({
        id: DIST_ID,
        lat: 7,
        precision: 'country',
        deleted_at: null,
      });
    });

    it('diff and export see the dashboard rows', async () => {
      const diff = await request(http)
        .get('/admin/distillery-locations/diff')
        .set(auth(admin))
        .expect(200);
      expect(diff.body.in_sync).toBe(false);
      expect(diff.body.only_in_table).toEqual(
        expect.arrayContaining([DIST_ID, `${DIST_ID}-scotia`]),
      );

      const exp = await request(http)
        .get('/admin/distillery-locations/export')
        .set(auth(admin))
        .expect(200);
      expect(exp.headers['content-disposition']).toContain(
        'distillery-location.json',
      );
      expect(exp.body._comment).toEqual(expect.any(String));
      expect(exp.body.distilleries).toEqual(
        expect.arrayContaining([
          { name: DIST, lat: 7, lon: 8, precision: 'country' },
        ]),
      );
    });
  });

  describe('/admin/regions', () => {
    const NORTH = `${LAND_ID}/north`;

    it('serves the tree with usage counts', async () => {
      const res = await request(http)
        .get('/admin/regions')
        .set(auth(admin))
        .expect(200);
      const scotland = res.body.find(
        (r: { id: string }) => r.id === 'scotland',
      );
      expect(scotland).toMatchObject({
        parent_id: null,
        deleted_at: null,
        tasting_count: expect.any(Number),
        smws_code_count: expect.any(Number),
      });
      const islay = scotland.subregions.find(
        (r: { id: string }) => r.id === 'scotland/islay',
      );
      expect(islay.smws_code_count).toBeGreaterThanOrEqual(1);
      expect(islay).not.toHaveProperty('subregions');
    });

    it('creates a country and its subregions', async () => {
      const country = await request(http)
        .post('/admin/regions')
        .set(auth(admin))
        .send({ name: LAND, lat: 1, lon: 2 })
        .expect(201);
      expect(country.body).toMatchObject({
        id: LAND_ID,
        parent_id: null,
        aliases: [],
      });
      for (const name of ['North', 'South']) {
        await request(http)
          .post('/admin/regions')
          .set(auth(admin))
          .send({ name, parent_id: LAND_ID })
          .expect(201);
      }
      await request(http)
        .post('/admin/regions')
        .set(auth(admin))
        .send({ name: 'North', parent_id: LAND_ID })
        .expect(409);
      await request(http)
        .post('/admin/regions')
        .set(auth(admin))
        .send({ name: 'Deeper', parent_id: NORTH })
        .expect(400);
      await request(http)
        .post('/admin/regions')
        .set(auth(admin))
        .send({ name: 'Orphan', parent_id: 'atlantis' })
        .expect(400);
    });

    it('a rename keeps the id and the old spelling as an alias', async () => {
      const res = await request(http)
        .patch(`/admin/regions/${enc(NORTH)}`)
        .set(auth(admin))
        .send({ name: 'Northern Reach', lat: 5, lon: 6, sort_order: 3 })
        .expect(200);
      expect(res.body).toMatchObject({
        id: NORTH,
        name: 'Northern Reach',
        aliases: ['North'],
        sort_order: 3,
      });
      const resolved = await app
        .get(RegionsService)
        .resolve(null, `North, ${LAND}`);
      expect(resolved?.id).toBe(NORTH);
    });

    it('reorders siblings', async () => {
      await request(http)
        .post('/admin/regions/reorder')
        .set(auth(admin))
        .send({ parent_id: LAND_ID, ids: [NORTH] })
        .expect(400);
      const res = await request(http)
        .post('/admin/regions/reorder')
        .set(auth(admin))
        .send({ parent_id: LAND_ID, ids: [`${LAND_ID}/south`, NORTH] })
        .expect(200);
      const land = res.body.find((r: { id: string }) => r.id === LAND_ID);
      expect(land.subregions.map((r: { id: string }) => r.id)).toEqual([
        `${LAND_ID}/south`,
        NORTH,
      ]);
    });

    it('delete is soft, takes the subregions along and keeps links', async () => {
      const linked = await tasting({ regionId: NORTH });
      const before = await request(http)
        .get('/tasteep/regions')
        .set(auth(member))
        .expect(200);

      // Deleted on its own earlier: must stay deleted when the country comes back.
      await regions.save(
        regions.create({
          id: `${LAND_ID}/gone`,
          name: 'Gone',
          parentId: LAND_ID,
        }),
      );
      await request(http)
        .delete(`/admin/regions/${enc(`${LAND_ID}/gone`)}`)
        .set(auth(admin))
        .expect(204);
      await new Promise((r) => setTimeout(r, 5));

      await request(http)
        .delete(`/admin/regions/${LAND_ID}`)
        .set(auth(admin))
        .expect(204);

      const after = await request(http)
        .get('/tasteep/regions')
        .set(auth(member))
        .expect(200);
      expect(after.headers.etag).not.toBe(before.headers.etag);
      expect(after.body.some((r: { id: string }) => r.id === LAND_ID)).toBe(
        false,
      );

      expect((await tastings.findOneByOrFail({ id: linked.id })).regionId).toBe(
        NORTH,
      );
      const svc = app.get(RegionsService);
      expect((await svc.resolve(NORTH, null))?.id).toBe(NORTH);
      expect(await svc.resolve(null, 'Northern Reach')).toBeNull();

      const withDeleted = await request(http)
        .get('/admin/regions?include_deleted=true')
        .set(auth(admin))
        .expect(200);
      const land = withDeleted.body.find(
        (r: { id: string }) => r.id === LAND_ID,
      );
      expect(land.deleted_at).not.toBeNull();
      expect(
        land.subregions.find((r: { id: string }) => r.id === NORTH),
      ).toMatchObject({ tasting_count: 1, deleted_at: expect.any(String) });

      await request(http)
        .post(`/admin/regions/${enc(NORTH)}/restore`)
        .set(auth(admin))
        .expect(409);
      await request(http)
        .post(`/admin/regions/${LAND_ID}/restore`)
        .set(auth(admin))
        .expect(200);
      const live = await regions.find({
        where: { parentId: LAND_ID },
        withDeleted: true,
      });
      expect(
        Object.fromEntries(live.map((r) => [r.id, r.deletedAt === null])),
      ).toEqual({
        [NORTH]: true,
        [`${LAND_ID}/south`]: true,
        [`${LAND_ID}/gone`]: false,
      });
    });

    it('diff and export see the dashboard rows', async () => {
      const diff = await request(http)
        .get('/admin/regions/diff')
        .set(auth(admin))
        .expect(200);
      expect(diff.body.only_in_table).toEqual(
        expect.arrayContaining([LAND_ID, NORTH]),
      );
      const exp = await request(http)
        .get('/admin/regions/export')
        .set(auth(admin))
        .expect(200);
      const land = exp.body.regions.find(
        (r: { main: string }) => r.main === LAND,
      );
      expect(land.sub).toEqual([
        { name: 'South', lat: null, lon: null },
        {
          id: NORTH,
          name: 'Northern Reach',
          lat: 5,
          lon: 6,
          aliases: ['North'],
        },
      ]);
    });
  });
});
