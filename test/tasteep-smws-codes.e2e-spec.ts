/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument --
   supertest types `res.body` as `any`; the assertions below are the typing. */
import '../src/env'; // must run before AppModule is required — see src/env.ts

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { In, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TasteepSession } from '../src/tasteep/entities/tasteep-session.entity';
import { TasteepSmwsCode } from '../src/tasteep/entities/tasteep-smws-code.entity';
import { TasteepUser } from '../src/tasteep/entities/tasteep-user.entity';
import {
  SmwsCodeSeedFile,
  seedRows,
  snapshotVersion,
} from '../src/tasteep/smws-codes/smws-codes.service';
import * as smwsCodeData from '../src/tasteep/data/smws-codes.json';

/**
 * SMWS code list, end to end against real Postgres: the boot seed, the app's
 * snapshot, and the admin CRUD / diff / export. Seeded rows are only read;
 * every write goes to a throw-away `ZZnnnn` code, hard-deleted in `afterAll`.
 */

jest.setTimeout(30_000);

const RUN = randomUUID().slice(0, 8);
const ADMIN_EMAIL = `e2e-codes-admin-${RUN}@tasteep.test`;
const CODE = `ZZ${randomInt(1000, 10000)}`;
const FILE = smwsCodeData as unknown as SmwsCodeSeedFile;

describe('SMWS codes (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let users: Repository<TasteepUser>;
  let sessions: Repository<TasteepSession>;
  let codes: Repository<TasteepSmwsCode>;
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
    codes = app.get(getRepositoryToken(TasteepSmwsCode));

    admin = await createUser(ADMIN_EMAIL);
    member = await createUser(`e2e-codes-member-${RUN}@tasteep.test`);
  });

  afterAll(async () => {
    if (!app) return;
    await codes.delete({ code: CODE });
    await users.delete({ id: In([admin.id, member.id]) });
    delete process.env.ADMIN_EMAILS;
    await app.close();
  });

  describe('seed', () => {
    it('put every code from the file in the table', async () => {
      const inTable = new Set(
        (await codes.find({ withDeleted: true })).map((r) => r.code),
      );
      const missing = seedRows(FILE)
        .map((r) => r.code)
        .filter((c) => !inTable.has(c));
      expect(missing).toEqual([]);
    });

    it('linked regions the picker knows', async () => {
      const byCode = new Map(
        (await codes.find({ where: { code: In(['3', 'B1', 'R1']) } })).map(
          (r) => [r.code, r.regionId],
        ),
      );
      expect(byCode.get('3')).toBe('scotland/islay'); // Islay
      expect(byCode.get('B1')).toBe('united-states/kentucky'); // Kentucky, USA
      expect(byCode.get('R1')).toBeNull(); // Jamaica: not in the picker
    });
  });

  describe('GET /tasteep/smws-codes', () => {
    it('401s without a token', async () => {
      await request(http).get('/tasteep/smws-codes').expect(401);
    });

    it('serves the snapshot with a verifiable version and an ETag', async () => {
      const res = await request(http)
        .get('/tasteep/smws-codes')
        .set(auth(member))
        .expect(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(240);
      expect(res.body.items[0]).toEqual({
        code: '1',
        distillery_name: 'Glenfarclas',
        category: 'single malt',
        region: 'Speyside',
        region_id: 'scotland/speyside',
        extra: null,
      });
      // What the app does to check its stored copy.
      expect(snapshotVersion(res.body.items)).toBe(res.body.version);
      expect(res.headers.etag).toBe(`W/"${res.body.version}"`);

      await request(http)
        .get('/tasteep/smws-codes')
        .set(auth(member))
        .set('If-None-Match', res.headers.etag)
        .expect(304);
    });
  });

  describe('admin', () => {
    it('403s a non-admin', async () => {
      await request(http)
        .get('/admin/smws-codes')
        .set(auth(member))
        .expect(403);
    });

    it('lists and filters', async () => {
      const res = await request(http)
        .get('/admin/smws-codes?category=rum&limit=5')
        .set(auth(admin))
        .expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(14);
      expect(res.body.items).toHaveLength(5);
      expect(
        res.body.items.every((i: { category: string }) => i.category === 'rum'),
      ).toBe(true);
      expect(res.body.items[0]).toHaveProperty('updated_at');
    });

    it('validates the create body', async () => {
      await request(http)
        .post('/admin/smws-codes')
        .set(auth(admin))
        .send({ code: 'not a code', distillery_name: 'X', category: 'rum' })
        .expect(400);
      await request(http)
        .post('/admin/smws-codes')
        .set(auth(admin))
        .send({
          code: CODE,
          distillery_name: 'X',
          category: 'rum',
          region_id: 'nowhere',
        })
        .expect(400);
    });

    it('create → patch → delete → restore, and the app snapshot follows', async () => {
      const before = await request(http)
        .get('/tasteep/smws-codes')
        .set(auth(member));

      const created = await request(http)
        .post('/admin/smws-codes')
        .set(auth(admin))
        .send({
          code: CODE,
          distillery_name: 'E2E Distillery',
          category: 'single malt',
          region: 'Islay',
        })
        .expect(201);
      expect(created.body).toMatchObject({
        code: CODE,
        region_id: 'scotland/islay',
        deleted_at: null,
      });
      await request(http)
        .post('/admin/smws-codes')
        .set(auth(admin))
        .send({ code: CODE, distillery_name: 'Again', category: 'rum' })
        .expect(409);

      const after = await request(http)
        .get('/tasteep/smws-codes')
        .set(auth(member))
        .set('If-None-Match', before.headers.etag)
        .expect(200);
      expect(after.body.version).not.toBe(before.body.version);
      expect(after.body.items.at(-1).code).toBe(CODE);

      const patched = await request(http)
        .patch(`/admin/smws-codes/${CODE}`)
        .set(auth(admin))
        .send({ extra: 'Closed', region: 'Speyside' })
        .expect(200);
      expect(patched.body).toMatchObject({
        extra: 'Closed',
        region: 'Speyside',
        region_id: 'scotland/speyside',
      });
      await request(http)
        .patch(`/admin/smws-codes/${CODE}`)
        .set(auth(admin))
        .send({ distillery_name: null })
        .expect(400);

      const diff = await request(http)
        .get('/admin/smws-codes/diff')
        .set(auth(admin))
        .expect(200);
      expect(diff.body.only_in_table).toContain(CODE);
      expect(diff.body.in_sync).toBe(false);

      await request(http)
        .delete(`/admin/smws-codes/${CODE}`)
        .set(auth(admin))
        .expect(204);
      const gone = await request(http)
        .get('/tasteep/smws-codes')
        .set(auth(member));
      expect(
        gone.body.items.map((i: { code: string }) => i.code),
      ).not.toContain(CODE);
      await request(http)
        .patch(`/admin/smws-codes/${CODE}`)
        .set(auth(admin))
        .send({ extra: 'x' })
        .expect(404);
      const listed = await request(http)
        .get(`/admin/smws-codes?q=${CODE}&include_deleted=true`)
        .set(auth(admin))
        .expect(200);
      expect(listed.body.items[0].deleted_at).not.toBeNull();

      const restored = await request(http)
        .post(`/admin/smws-codes/${CODE}/restore`)
        .set(auth(admin))
        .expect(200);
      expect(restored.body).toMatchObject({ code: CODE, deleted_at: null });
    });

    it('exports the table in the seed file format', async () => {
      const res = await request(http)
        .get('/admin/smws-codes/export')
        .set(auth(admin))
        .expect(200);
      expect(res.headers['content-disposition']).toContain('smws-codes.json');
      expect(res.body['single malt'].distilleries[0]).toEqual({
        distilleryName: 'Glenfarclas',
        smwsId: 1,
        region: 'Speyside',
        extra: null,
      });
      expect(res.body['grain whisky'].distilleries[0].smwsId).toBe('G1');
    });
  });
});
