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
import { TasteepGeocodeCache } from '../src/tasteep/entities/tasteep-geocode-cache.entity';
import { TasteepSession } from '../src/tasteep/entities/tasteep-session.entity';
import { TasteepTasting } from '../src/tasteep/entities/tasteep-tasting.entity';
import { TasteepUser } from '../src/tasteep/entities/tasteep-user.entity';
import { NominatimClient } from '../src/tasteep/geocode/nominatim.client';
import type { GeocodeHit } from '../src/tasteep/geocode/nominatim.client';
import type { TastingJson } from '../src/tasteep/tastings/tasting.mapper';

/**
 * Phase 2 (Atlas) contract, end to end: real Nest app, real Postgres (the one
 * `.env` points at), real JWT guard and validation pipe. Only Nominatim is
 * stubbed — its usage policy forbids automated querying, and the unit tests
 * already cover the client's response mapping.
 *
 * Every row this suite creates is scoped to two throw-away users that are
 * deleted in `afterAll` (tastings and sessions cascade); the geocode cache
 * rows it creates are removed explicitly.
 */

jest.setTimeout(30_000);

const RUN = randomUUID().slice(0, 8);
const ISLAY_QUERY = `e2e-${RUN} islay`;
const NOWHERE_QUERY = `e2e-${RUN} nowhere`;

/** Every key of `lib/models/tasting.dart` — the exact wire contract. */
const TASTING_KEYS = [
  'id',
  'name',
  'category',
  'photo_path',
  'distillery',
  'region',
  'abv',
  'price',
  'age_statement',
  'cask_type',
  'date_tasted',
  'location',
  'score',
  'appearance',
  'tags',
  'nose',
  'palate',
  'finish',
  'lat',
  'lon',
  'location_precision',
  'created_at',
  'updated_at',
].sort();

const nominatim = {
  search: jest.fn<Promise<GeocodeHit | null>, [string]>(),
};

describe('Tasteep phase 2 — Atlas (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let users: Repository<TasteepUser>;
  let sessions: Repository<TasteepSession>;
  let tastings: Repository<TasteepTasting>;
  let cache: Repository<TasteepGeocodeCache>;

  let alice: { id: string; token: string };
  let bob: { id: string; token: string };

  // Alice's journal. Dates chosen so the expected list order is t2, t1, t3, t4.
  const t1 = randomUUID(); // Lagavulin, Islay, 88, unknown, 2026-03-10
  const t2 = randomUUID(); // Lagavulin, Islay, 90, country + coords, 2026-05-01
  const t3 = randomUUID(); // Ardbeg, Islay, 70, region + coords, 2025-12-25
  const t4 = randomUUID(); // no distillery, no score, exact + coords, undated
  const bobsTasting = randomUUID();

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const tasting = (res: request.Response) => res.body as TastingJson;
  const tastingList = (res: request.Response) => res.body as TastingJson[];
  const ids = (res: request.Response) => tastingList(res).map((t) => t.id);
  const errorMessage = (res: request.Response) =>
    (res.body as { message: string | string[] }).message;

  const body = (over: Record<string, unknown> = {}) => ({
    name: 'Lagavulin 16',
    category: 'whisky',
    photo_path: null,
    distillery: 'Lagavulin',
    region: 'Islay',
    abv: 43,
    price: 65.5,
    age_statement: '16',
    cask_type: 'Ex-bourbon & sherry',
    date_tasted: '2026-03-10T19:00:00.000Z',
    location: 'Home',
    score: 88,
    appearance: 'Deep amber',
    tags: ['peat', 'smoke'],
    nose: 'Bonfire',
    palate: 'Iodine',
    finish: 'Long',
    lat: null,
    lon: null,
    location_precision: 'unknown',
    ...over,
  });

  async function createUser(
    label: string,
  ): Promise<{ id: string; token: string }> {
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
    let moduleRef: TestingModule;
    try {
      moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(NominatimClient)
        .useValue(nominatim)
        .compile();
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
    tastings = app.get(getRepositoryToken(TasteepTasting));
    cache = app.get(getRepositoryToken(TasteepGeocodeCache));

    alice = await createUser('alice');
    bob = await createUser('bob');
  });

  afterAll(async () => {
    if (!app) return;
    await cache.delete({ query: In([ISLAY_QUERY, NOWHERE_QUERY]) });
    await users.delete({ id: In([alice.id, bob.id]) }); // cascades sessions + tastings
    await app.close();
  });

  beforeEach(() => nominatim.search.mockReset());

  // ---------------------------------------------------------------------------

  describe('auth gate', () => {
    it.each([
      ['get', '/tasteep/tastings'],
      ['get', '/tasteep/tastings?unplaced=true'],
      ['get', '/tasteep/stats'],
      ['get', '/tasteep/cabinet'],
      ['post', '/tasteep/geocode'],
    ] as const)('%s %s → 401 without a bearer token', async (method, url) => {
      await request(http)[method](url).expect(401);
    });

    it('rejects a token whose session was revoked', async () => {
      const mallory = await createUser('mallory');
      await request(http)
        .get('/tasteep/stats')
        .set(auth(mallory.token))
        .expect(200);
      await request(http)
        .post('/auth/signout')
        .set(auth(mallory.token))
        .expect(204);
      await request(http)
        .get('/tasteep/stats')
        .set(auth(mallory.token))
        .expect(401);
      await users.delete({ id: mallory.id });
    });
  });

  describe('seed journal via PUT /tasteep/tastings/:id', () => {
    it('creates rows with the exact client contract', async () => {
      const res = await request(http)
        .put(`/tasteep/tastings/${t1}`)
        .set(auth(alice.token))
        .send(body())
        .expect(200);

      expect(Object.keys(tasting(res)).sort()).toEqual(TASTING_KEYS);
      expect(tasting(res)).toMatchObject({
        id: t1,
        name: 'Lagavulin 16',
        abv: 43,
        price: 65.5,
        score: 88,
        tags: ['peat', 'smoke'],
        date_tasted: '2026-03-10T19:00:00.000Z',
        lat: null,
        lon: null,
        location_precision: 'unknown',
      });
      expect(typeof tasting(res).created_at).toBe('string');

      await request(http)
        .put(`/tasteep/tastings/${t2}`)
        .set(auth(alice.token))
        .send(
          body({
            name: 'Lagavulin 8',
            score: 90,
            date_tasted: '2026-05-01T12:00:00.000Z',
            lat: 56.49,
            lon: -4.2,
            location_precision: 'country',
          }),
        )
        .expect(200);

      await request(http)
        .put(`/tasteep/tastings/${t3}`)
        .set(auth(alice.token))
        .send(
          body({
            name: 'Ardbeg 10',
            distillery: 'Ardbeg',
            score: 70,
            date_tasted: '2025-12-25T18:00:00.000Z',
            lat: 55.75,
            lon: -6.17,
            location_precision: 'region',
          }),
        )
        .expect(200);

      const undated = await request(http)
        .put(`/tasteep/tastings/${t4}`)
        .set(auth(alice.token))
        .send(
          body({
            name: 'Mystery dram',
            category: 'other',
            distillery: null,
            region: null,
            score: null,
            date_tasted: null,
            lat: 55.6404,
            lon: -6.1263,
            location_precision: 'exact',
          }),
        )
        .expect(200);
      expect(tasting(undated)).toMatchObject({
        distillery: null,
        score: null,
        date_tasted: null,
        location_precision: 'exact',
      });

      await request(http)
        .put(`/tasteep/tastings/${bobsTasting}`)
        .set(auth(bob.token))
        .send(
          body({
            name: "Bob's rum",
            category: 'rum',
            distillery: 'Foursquare',
          }),
        )
        .expect(200);
    });

    it('rejects a non-UUID id and an invalid body', async () => {
      await request(http)
        .put('/tasteep/tastings/not-a-uuid')
        .set(auth(alice.token))
        .send(body())
        .expect(400);
      const res = await request(http)
        .put(`/tasteep/tastings/${randomUUID()}`)
        .set(auth(alice.token))
        .send(body({ name: '', score: 101, location_precision: 'gps' }))
        .expect(400);
      expect(errorMessage(res)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('name'),
          expect.stringContaining('score'),
          expect.stringContaining('location_precision'),
        ]),
      );
    });

    it('409s when the id belongs to another account', async () => {
      await request(http)
        .put(`/tasteep/tastings/${t1}`)
        .set(auth(bob.token))
        .send(body())
        .expect(409);
    });
  });

  describe('GET /tasteep/tastings', () => {
    it('lists only my rows, newest date_tasted first, undated last', async () => {
      const res = await request(http)
        .get('/tasteep/tastings')
        .set(auth(alice.token))
        .expect(200);
      expect(ids(res)).toEqual([t2, t1, t3, t4]);
    });

    it('?unplaced=true keeps only unknown/country precision', async () => {
      const res = await request(http)
        .get('/tasteep/tastings?unplaced=true')
        .set(auth(alice.token))
        .expect(200);
      expect(ids(res)).toEqual([t2, t1]);
      expect(tastingList(res).map((t) => t.location_precision)).toEqual([
        'country',
        'unknown',
      ]);
    });

    it('?unplaced=1 is accepted too, anything else means false', async () => {
      const one = await request(http)
        .get('/tasteep/tastings?unplaced=1')
        .set(auth(alice.token))
        .expect(200);
      expect(tastingList(one)).toHaveLength(2);
      const no = await request(http)
        .get('/tasteep/tastings?unplaced=no')
        .set(auth(alice.token))
        .expect(200);
      expect(tastingList(no)).toHaveLength(4);
    });

    it("never shows another user's tasting", async () => {
      await request(http)
        .get(`/tasteep/tastings/${bobsTasting}`)
        .set(auth(alice.token))
        .expect(404);
    });
  });

  describe('GET /tasteep/stats', () => {
    it('aggregates only my journal', async () => {
      const res = await request(http)
        .get('/tasteep/stats')
        .set(auth(alice.token))
        .expect(200);
      // avg of 88, 90, 70 (the null score is ignored); Lagavulin + Ardbeg (null ignored)
      expect(res.body).toEqual({
        count: 4,
        avg_score: 82.7,
        distinct_distilleries: 2,
      });
    });

    it('is zeros / null for an empty journal', async () => {
      const nobody = await createUser('nobody');
      const res = await request(http)
        .get('/tasteep/stats')
        .set(auth(nobody.token))
        .expect(200);
      expect(res.body).toEqual({
        count: 0,
        avg_score: null,
        distinct_distilleries: 0,
      });
      await users.delete({ id: nobody.id });
    });
  });

  describe('GET /tasteep/cabinet', () => {
    it('groups by distillery, most-stocked first, null group last', async () => {
      const res = await request(http)
        .get('/tasteep/cabinet')
        .set(auth(alice.token))
        .expect(200);
      expect(res.body).toEqual([
        { distillery: 'Lagavulin', count: 2, avg_score: 89 },
        { distillery: 'Ardbeg', count: 1, avg_score: 70 },
        { distillery: null, count: 1, avg_score: null },
      ]);
    });
  });

  describe('PUT /tasteep/tastings/:id/location', () => {
    const url = (id: string) => `/tasteep/tastings/${id}/location`;

    it('validates the body', async () => {
      await request(http)
        .put(url(t1))
        .set(auth(alice.token))
        .send({ lat: 1, lon: 2 })
        .expect(400); // precision missing
      await request(http)
        .put(url(t1))
        .set(auth(alice.token))
        .send({ lat: 91, lon: 2, precision: 'manual' })
        .expect(400); // lat out of range
      await request(http)
        .put(url(t1))
        .set(auth(alice.token))
        .send({ precision: 'manual' })
        .expect(400); // lat/lon required unless clearing
    });

    it('accepts an automated result on an unpinned tasting', async () => {
      const res = await request(http)
        .put(url(t1))
        .set(auth(alice.token))
        .send({ lat: 55.7585, lon: -6.1657, precision: 'region' })
        .expect(200);
      expect(tasting(res)).toMatchObject({
        id: t1,
        lat: 55.7585,
        lon: -6.1657,
        location_precision: 'region',
      });
      expect(Object.keys(tasting(res)).sort()).toEqual(TASTING_KEYS);
    });

    it('a manual pin wins over any later automated result', async () => {
      await request(http)
        .put(url(t1))
        .set(auth(alice.token))
        .send({ lat: 55.63, lon: -6.13, precision: 'manual' })
        .expect(200);

      const rejected = await request(http)
        .put(url(t1))
        .set(auth(alice.token))
        .send({ lat: 1, lon: 2, precision: 'exact' })
        .expect(409);
      expect(errorMessage(rejected)).toMatch(/pinned manually/);

      // A full upsert carrying an automated precision does not move it either.
      const upserted = await request(http)
        .put(`/tasteep/tastings/${t1}`)
        .set(auth(alice.token))
        .send(body({ lat: 1, lon: 2, location_precision: 'exact' }))
        .expect(200);
      expect(tasting(upserted)).toMatchObject({
        lat: 55.63,
        lon: -6.13,
        location_precision: 'manual',
      });

      const row = await tastings.findOneByOrFail({ id: t1 });
      expect([row.lat, row.lon, row.locationPrecision]).toEqual([
        55.63,
        -6.13,
        'manual',
      ]);
    });

    it('a second manual pin moves it', async () => {
      const res = await request(http)
        .put(url(t1))
        .set(auth(alice.token))
        .send({ lat: 55.64, lon: -6.12, precision: 'manual' })
        .expect(200);
      expect(tasting(res)).toMatchObject({ lat: 55.64, lon: -6.12 });
    });

    it('unknown clears the pin, after which automated results are accepted again', async () => {
      const cleared = await request(http)
        .put(url(t1))
        .set(auth(alice.token))
        .send({ precision: 'unknown' })
        .expect(200);
      expect(tasting(cleared)).toMatchObject({
        lat: null,
        lon: null,
        location_precision: 'unknown',
      });

      const unplaced = await request(http)
        .get('/tasteep/tastings?unplaced=true')
        .set(auth(alice.token))
        .expect(200);
      expect(ids(unplaced)).toContain(t1);

      await request(http)
        .put(url(t1))
        .set(auth(alice.token))
        .send({ lat: 55.75, lon: -6.17, precision: 'exact' })
        .expect(200);
    });

    it("404s on another user's tasting", async () => {
      await request(http)
        .put(url(bobsTasting))
        .set(auth(alice.token))
        .send({ lat: 1, lon: 2, precision: 'manual' })
        .expect(404);
    });
  });

  describe('POST /tasteep/geocode', () => {
    it('validates the query', async () => {
      await request(http)
        .post('/tasteep/geocode')
        .set(auth(alice.token))
        .send({})
        .expect(400);
      await request(http)
        .post('/tasteep/geocode')
        .set(auth(alice.token))
        .send({ query: 'x'.repeat(201) })
        .expect(400);
      await request(http)
        .post('/tasteep/geocode')
        .set(auth(alice.token))
        .send({ query: '   ' })
        .expect(400);
      expect(nominatim.search).not.toHaveBeenCalled();
    });

    it('resolves through Nominatim once, then serves the cache', async () => {
      nominatim.search.mockResolvedValue({
        lat: 55.7585802,
        lon: -6.1656723,
        precision: 'region',
      });

      const first = await request(http)
        .post('/tasteep/geocode')
        .set(auth(alice.token))
        .send({ query: `  ${ISLAY_QUERY.toUpperCase()}  ` })
        .expect(200);
      expect(first.body).toEqual({
        lat: 55.7585802,
        lon: -6.1656723,
        precision: 'region',
      });
      expect(nominatim.search).toHaveBeenCalledTimes(1);
      expect(nominatim.search).toHaveBeenCalledWith(ISLAY_QUERY);

      // Different user, different casing/whitespace: same cache row, no upstream call.
      const second = await request(http)
        .post('/tasteep/geocode')
        .set(auth(bob.token))
        .send({ query: ISLAY_QUERY })
        .expect(200);
      expect(second.body).toEqual(first.body);
      expect(nominatim.search).toHaveBeenCalledTimes(1);

      const row = await cache.findOneByOrFail({ query: ISLAY_QUERY });
      expect(row).toMatchObject({
        lat: 55.7585802,
        lon: -6.1656723,
        precision: 'region',
        provider: 'nominatim',
      });
    });

    it('caches a miss as unknown and never re-queries it', async () => {
      nominatim.search.mockResolvedValue(null);
      await request(http)
        .post('/tasteep/geocode')
        .set(auth(alice.token))
        .send({ query: NOWHERE_QUERY })
        .expect(404);
      await request(http)
        .post('/tasteep/geocode')
        .set(auth(alice.token))
        .send({ query: NOWHERE_QUERY })
        .expect(404);
      expect(nominatim.search).toHaveBeenCalledTimes(1);

      const row = await cache.findOneByOrFail({ query: NOWHERE_QUERY });
      expect(row).toMatchObject({ lat: null, lon: null, precision: 'unknown' });
    });

    it('a geocode result can be stored on a tasting via the location route', async () => {
      const geo = await request(http)
        .post('/tasteep/geocode')
        .set(auth(alice.token))
        .send({ query: ISLAY_QUERY })
        .expect(200);
      const saved = await request(http)
        .put(`/tasteep/tastings/${t2}/location`)
        .set(auth(alice.token))
        .send(geo.body as object)
        .expect(200);
      expect(tasting(saved)).toMatchObject({
        lat: 55.7585802,
        lon: -6.1656723,
        location_precision: 'region',
      });

      const unplaced = await request(http)
        .get('/tasteep/tastings?unplaced=true')
        .set(auth(alice.token))
        .expect(200);
      expect(ids(unplaced)).not.toContain(t2);
    });
  });

  describe('DELETE /tasteep/tastings/:id', () => {
    it("404s on another user's tasting, 204 on mine, and stats follow", async () => {
      await request(http)
        .delete(`/tasteep/tastings/${bobsTasting}`)
        .set(auth(alice.token))
        .expect(404);
      await request(http)
        .delete(`/tasteep/tastings/${t4}`)
        .set(auth(alice.token))
        .expect(204);
      await request(http)
        .get(`/tasteep/tastings/${t4}`)
        .set(auth(alice.token))
        .expect(404);
      await request(http)
        .delete(`/tasteep/tastings/${t4}`)
        .set(auth(alice.token))
        .expect(404);

      const stats = await request(http)
        .get('/tasteep/stats')
        .set(auth(alice.token))
        .expect(200);
      expect(stats.body).toEqual({
        count: 3,
        avg_score: 82.7,
        distinct_distilleries: 2,
      });
      const cabinet = await request(http)
        .get('/tasteep/cabinet')
        .set(auth(alice.token))
        .expect(200);
      expect(cabinet.body as unknown[]).toHaveLength(2);
    });
  });
});
