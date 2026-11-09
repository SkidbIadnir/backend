/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument --
   supertest types `res.body` as `any`; the assertions below are the typing. */
import '../src/env'; // must run before AppModule is required — see src/env.ts

import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { In, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { SmwsBottleSyncService } from '../src/tasteep/smws-bottles/smws-bottle-sync.service';
import { TasteepGeocodeCache } from '../src/tasteep/entities/tasteep-geocode-cache.entity';
import { TasteepSession } from '../src/tasteep/entities/tasteep-session.entity';
import { TasteepTasting } from '../src/tasteep/entities/tasteep-tasting.entity';
import { TasteepUser } from '../src/tasteep/entities/tasteep-user.entity';

/**
 * Admin API, end to end: real Nest app, real Postgres, real guards. The
 * scraper is replaced so no browser is launched. All rows belong to throw-away
 * users (deleted in `afterAll`, which cascades) or a prefixed geocode key.
 */

jest.setTimeout(30_000);

const RUN = randomUUID().slice(0, 8);
const ADMIN_EMAIL = `e2e-admin-${RUN}@tasteep.test`;

describe('Admin API (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let users: Repository<TasteepUser>;
  let sessions: Repository<TasteepSession>;
  let tastings: Repository<TasteepTasting>;
  let geocode: Repository<TasteepGeocodeCache>;
  let admin: { id: string; sid: string; token: string };
  let member: { id: string; sid: string; token: string };
  let scraping = false;
  let finishScrape: () => void;
  const runScrape = jest.fn(
    () =>
      new Promise<null>((resolve) => {
        scraping = true;
        finishScrape = () => {
          scraping = false;
          resolve(null);
        };
      }),
  );

  const auth = (t: { token: string }) => ({
    Authorization: `Bearer ${t.token}`,
  });

  async function createUser(label: string, email: string, createdAt?: Date) {
    const user = await users.save(
      users.create({
        email,
        displayName: label,
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
    if (createdAt) {
      await sessions.update({ id: session.id }, { createdAt });
    }
    const token = app
      .get(JwtService)
      .sign({ sub: user.id, sid: session.id }, { expiresIn: '1h' });
    return { id: user.id, sid: session.id, token };
  }

  beforeAll(async () => {
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmwsBottleSyncService)
      .useValue({ run: runScrape, isRunning: () => scraping })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); // same as main.ts
    await app.init();
    http = app.getHttpServer();

    users = app.get(getRepositoryToken(TasteepUser));
    sessions = app.get(getRepositoryToken(TasteepSession));
    tastings = app.get(getRepositoryToken(TasteepTasting));
    geocode = app.get(getRepositoryToken(TasteepGeocodeCache));

    admin = await createUser('admin', ADMIN_EMAIL);
    member = await createUser('member', `e2e-member-${RUN}@tasteep.test`);

    await tastings.save([
      tastings.create({
        id: randomUUID(),
        userId: member.id,
        name: 'Placed',
        category: 'whisky',
        score: 87,
        tags: ['peat', 'smoke'],
        distillery: `E2E Distillery ${RUN}`,
        locationPrecision: 'exact',
        lat: 55.6,
        lon: -6.1,
      }),
      tastings.create({
        id: randomUUID(),
        userId: member.id,
        name: 'Unplaced',
        category: 'rum',
        score: 42,
        tags: ['peat'],
        locationPrecision: 'unknown',
      }),
    ]);
    await geocode.save(
      geocode.create({
        query: `e2e-nowhere-${RUN}`,
        lat: null,
        lon: null,
        precision: 'unknown',
      }),
    );
  });

  afterAll(async () => {
    if (!app) return;
    await geocode.delete({ query: `e2e-nowhere-${RUN}` });
    await users.delete({ id: In([admin.id, member.id]) }); // cascades sessions + tastings
    delete process.env.ADMIN_EMAILS;
    await app.close();
  });

  describe('auth gate', () => {
    it.each([
      '/admin/stats/overview',
      '/admin/users',
      '/admin/tastings',
      '/admin/smws/status',
      '/admin/logs',
    ])('401s %s without a token', async (path) => {
      await request(http).get(path).expect(401);
    });

    it('403s a signed-in user who is not on the allowlist', async () => {
      await request(http).get('/admin/users').set(auth(member)).expect(403);
    });

    it('401s an allowlisted admin whose session is older than 12h', async () => {
      const old = await sessions.save(
        sessions.create({
          userId: admin.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          revokedAt: null,
          lastSeenAt: new Date(),
        }),
      );
      await sessions.update(
        { id: old.id },
        { createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000) },
      );
      const token = app
        .get(JwtService)
        .sign({ sub: admin.id, sid: old.id }, { expiresIn: '1h' });
      await request(http)
        .get('/admin/users')
        .set({ Authorization: `Bearer ${token}` })
        .expect(401);
    });

    it('lets the admin in', async () => {
      await request(http).get('/admin/users').set(auth(admin)).expect(200);
    });
  });

  describe('users and tastings', () => {
    it('lists users with tasting counts, paginated, and filters by q', async () => {
      const res = await request(http)
        .get(`/admin/users?q=e2e-member-${RUN}&limit=5`)
        .set(auth(admin))
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({
        id: member.id,
        provider: 'email',
        tasting_count: 2,
      });
    });

    it('rejects an out-of-range limit', async () => {
      await request(http)
        .get('/admin/users?limit=9999')
        .set(auth(admin))
        .expect(400);
    });

    it('returns a user with sessions', async () => {
      const res = await request(http)
        .get(`/admin/users/${member.id}`)
        .set(auth(admin))
        .expect(200);
      expect(res.body.tasting_count).toBe(2);
      expect(res.body.sessions.map((s: { id: string }) => s.id)).toContain(
        member.sid,
      );
    });

    it('404s an unknown user and 400s a non-UUID id', async () => {
      await request(http)
        .get(`/admin/users/${randomUUID()}`)
        .set(auth(admin))
        .expect(404);
      await request(http).get('/admin/users/nope').set(auth(admin)).expect(400);
    });

    it('filters tastings by user and by unplaced', async () => {
      const all = await request(http)
        .get(`/admin/tastings?user_id=${member.id}`)
        .set(auth(admin))
        .expect(200);
      expect(all.body.total).toBe(2);

      const unplaced = await request(http)
        .get(`/admin/tastings?user_id=${member.id}&unplaced=true`)
        .set(auth(admin))
        .expect(200);
      expect(unplaced.body.total).toBe(1);
      expect(unplaced.body.items[0]).toMatchObject({
        name: 'Unplaced',
        location_precision: 'unknown',
      });

      const rum = await request(http)
        .get(`/admin/tastings?user_id=${member.id}&category=rum`)
        .set(auth(admin))
        .expect(200);
      expect(rum.body.total).toBe(1);
    });

    it('lists cached geocode misses', async () => {
      const res = await request(http)
        .get('/admin/geocode/misses?limit=200')
        .set(auth(admin))
        .expect(200);
      expect(res.body.items.map((i: { query: string }) => i.query)).toContain(
        `e2e-nowhere-${RUN}`,
      );
    });
  });

  describe('stats', () => {
    it('returns the overview shape with numeric counts', async () => {
      const res = await request(http)
        .get('/admin/stats/overview')
        .set(auth(admin))
        .expect(200);
      expect(res.body.totals.users).toBeGreaterThanOrEqual(2);
      expect(res.body.totals.tastings).toBeGreaterThanOrEqual(2);
      expect(res.body.active_sessions.last_7d).toBeGreaterThanOrEqual(2);
      expect(res.body.users_by_provider).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'email',
            count: expect.any(Number),
          }),
        ]),
      );
      expect(res.body.top_tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tag: 'peat', count: expect.any(Number) }),
        ]),
      );
      expect(res.body.score_histogram).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ bucket: 80 }),
          expect.objectContaining({ bucket: 40 }),
        ]),
      );
    });

    it('returns OTP stats', async () => {
      const res = await request(http)
        .get('/admin/auth/otps/stats')
        .set(auth(admin))
        .expect(200);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'consumed',
          'expired',
          'failed',
          'last_24h',
          'pending',
          'total',
        ].sort(),
      );
    });
  });

  describe('revocation', () => {
    it('revoking a session makes that token 401 afterwards', async () => {
      const victim = await createUser(
        'victim',
        `e2e-victim-${RUN}@tasteep.test`,
      );
      await request(http).get('/auth/me').set(auth(victim)).expect(200);

      const res = await request(http)
        .post(`/admin/sessions/${victim.sid}/revoke`)
        .set(auth(admin))
        .expect(200);
      expect(res.body).toEqual({ revoked: true });

      await request(http).get('/auth/me').set(auth(victim)).expect(401);

      // Second revoke: the session exists but is already revoked.
      const again = await request(http)
        .post(`/admin/sessions/${victim.sid}/revoke`)
        .set(auth(admin))
        .expect(200);
      expect(again.body).toEqual({ revoked: false });

      await users.delete({ id: victim.id });
    });

    it('revoke-all revokes every live session of a user', async () => {
      const res = await request(http)
        .post(`/admin/users/${member.id}/revoke-all`)
        .set(auth(admin))
        .expect(200);
      expect(res.body.revoked).toBeGreaterThanOrEqual(1);
      await request(http).get('/auth/me').set(auth(member)).expect(401);
    });

    it('404s unknown session and user ids', async () => {
      await request(http)
        .post(`/admin/sessions/${randomUUID()}/revoke`)
        .set(auth(admin))
        .expect(404);
      await request(http)
        .post(`/admin/users/${randomUUID()}/revoke-all`)
        .set(auth(admin))
        .expect(404);
    });
  });

  describe('smws', () => {
    it('reports status including scraper run state', async () => {
      const res = await request(http)
        .get('/admin/smws/status')
        .set(auth(admin))
        .expect(200);
      expect(res.body.bottles).toEqual(
        expect.objectContaining({
          total: expect.any(Number),
          available: expect.any(Number),
          delisted: expect.any(Number),
        }),
      );
      expect(res.body.scraper.running).toBe(false);
      expect(Array.isArray(res.body.scraper.recent_runs)).toBe(true);
    });

    it('starts a run with 202, then 409s while it is still running', async () => {
      await request(http)
        .post('/admin/smws/scraper/run')
        .set(auth(admin))
        .expect(202)
        .expect({ started: true });
      expect(runScrape).toHaveBeenCalledWith('admin');

      await request(http)
        .post('/admin/smws/scraper/run')
        .set(auth(admin))
        .expect(409);
      expect(runScrape).toHaveBeenCalledTimes(1);

      finishScrape();
    });

    it('does not let a non-admin start a run', async () => {
      const outsider = await createUser(
        'outsider',
        `e2e-outsider-${RUN}@tasteep.test`,
      );
      await request(http)
        .post('/admin/smws/scraper/run')
        .set(auth(outsider))
        .expect(403);
      await users.delete({ id: outsider.id });
    });
  });

  describe('logs', () => {
    it('returns the log feed contract', async () => {
      const res = await request(http)
        .get('/admin/logs?context=AdminAudit&limit=50')
        .set(auth(admin))
        .expect(200);
      // The e2e app doesn't install AdminLogger (main.ts does), so the buffer
      // may be empty here — assert the contract, not the content.
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.total).toBe(res.body.items.length);
    });

    it('rejects an invalid level', async () => {
      await request(http)
        .get('/admin/logs?level=loud')
        .set(auth(admin))
        .expect(400);
    });
  });
});
