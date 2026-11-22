/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument --
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
import { TasteepFeedback } from '../src/tasteep/entities/tasteep-feedback.entity';
import { TasteepSession } from '../src/tasteep/entities/tasteep-session.entity';
import { TasteepUser } from '../src/tasteep/entities/tasteep-user.entity';

/**
 * User feedback, end to end: submit as a member through `/tasteep/feedback`,
 * triage as an admin through `/admin/feedback`. Real Nest app, real Postgres,
 * real guards. Rows belong to throw-away users deleted in `afterAll`
 * (feedback and sessions cascade).
 */

jest.setTimeout(30_000);

const RUN = randomUUID().slice(0, 8);
const ADMIN_EMAIL = `e2e-fb-admin-${RUN}@tasteep.test`;
const MAX_PER_HOUR = 3;

describe('Tasteep feedback (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let users: Repository<TasteepUser>;
  let sessions: Repository<TasteepSession>;
  let feedback: Repository<TasteepFeedback>;
  let admin: { id: string; token: string };
  let member: { id: string; token: string };
  let flooder: { id: string; token: string };

  const auth = (t: { token: string }) => ({
    Authorization: `Bearer ${t.token}`,
  });

  async function createUser(label: string, email: string) {
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
    const token = app
      .get(JwtService)
      .sign({ sub: user.id, sid: session.id }, { expiresIn: '1h' });
    return { id: user.id, token };
  }

  beforeAll(async () => {
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
    process.env.TASTEEP_FEEDBACK_MAX_PER_HOUR = String(MAX_PER_HOUR);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); // same as main.ts
    await app.init();
    http = app.getHttpServer();

    users = app.get(getRepositoryToken(TasteepUser));
    sessions = app.get(getRepositoryToken(TasteepSession));
    feedback = app.get(getRepositoryToken(TasteepFeedback));

    admin = await createUser('admin', ADMIN_EMAIL);
    member = await createUser('member', `e2e-fb-member-${RUN}@tasteep.test`);
    flooder = await createUser('flooder', `e2e-fb-flood-${RUN}@tasteep.test`);
  });

  afterAll(async () => {
    if (!app) return;
    await users.delete({ id: In([admin.id, member.id, flooder.id]) });
    delete process.env.ADMIN_EMAILS;
    delete process.env.TASTEEP_FEEDBACK_MAX_PER_HOUR;
    await app.close();
  });

  describe('POST /tasteep/feedback', () => {
    it('401 without a token', () =>
      request(http)
        .post('/tasteep/feedback')
        .send({ type: 'bug', message: 'x' })
        .expect(401));

    it('400 on an unknown type, an empty or an oversized message', async () => {
      await request(http)
        .post('/tasteep/feedback')
        .set(auth(member))
        .send({ type: 'rant', message: 'x' })
        .expect(400);
      await request(http)
        .post('/tasteep/feedback')
        .set(auth(member))
        .send({ type: 'bug', message: '' })
        .expect(400);
      await request(http)
        .post('/tasteep/feedback')
        .set(auth(member))
        .send({ type: 'bug', message: '   ' })
        .expect(400);
      await request(http)
        .post('/tasteep/feedback')
        .set(auth(member))
        .send({ type: 'bug', message: 'a'.repeat(4001) })
        .expect(400);
    });

    it('201 stores the message for the caller and drops unknown fields', async () => {
      const res = await request(http)
        .post('/tasteep/feedback')
        .set(auth(member))
        .send({
          type: 'idea',
          message: `  ${RUN} please add dark mode  `,
          app_version: '1.4.0+42',
          platform: 'android',
          status: 'archived',
          user_id: admin.id,
        })
        .expect(201);

      expect(Object.keys(res.body).sort()).toEqual(['created_at', 'id']);
      const row = await feedback.findOneByOrFail({ id: res.body.id });
      expect(row).toMatchObject({
        userId: member.id,
        type: 'idea',
        message: `${RUN} please add dark mode`,
        appVersion: '1.4.0+42',
        platform: 'android',
        status: 'new',
      });
    });

    it(`429 after ${MAX_PER_HOUR} messages in an hour, per user`, async () => {
      for (let i = 0; i < MAX_PER_HOUR; i++) {
        await request(http)
          .post('/tasteep/feedback')
          .set(auth(flooder))
          .send({ type: 'other', message: `msg ${i}` })
          .expect(201);
      }
      await request(http)
        .post('/tasteep/feedback')
        .set(auth(flooder))
        .send({ type: 'other', message: 'one too many' })
        .expect(429);
      // Another user isn't affected.
      await request(http)
        .post('/tasteep/feedback')
        .set(auth(member))
        .send({ type: 'bug', message: `${RUN} still allowed` })
        .expect(201);
    });
  });

  describe('/admin/feedback', () => {
    it('403 for a non-admin', () =>
      request(http).get('/admin/feedback').set(auth(member)).expect(403));

    it('lists newest first with the author, filtered by user and type', async () => {
      const res = await request(http)
        .get('/admin/feedback')
        .query({ user_id: member.id })
        .set(auth(admin))
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.items.map((f: { message: string }) => f.message)).toEqual(
        [`${RUN} still allowed`, `${RUN} please add dark mode`],
      );
      expect(res.body.items[1]).toMatchObject({
        user_id: member.id,
        user_email: `e2e-fb-member-${RUN}@tasteep.test`,
        user_display_name: 'member',
        type: 'idea',
        app_version: '1.4.0+42',
        platform: 'android',
        status: 'new',
      });

      const ideas = await request(http)
        .get('/admin/feedback')
        .query({ user_id: member.id, type: 'idea' })
        .set(auth(admin))
        .expect(200);
      expect(ideas.body.total).toBe(1);
    });

    it('400 on an unknown status filter', () =>
      request(http)
        .get('/admin/feedback')
        .query({ status: 'done' })
        .set(auth(admin))
        .expect(400));

    it('PATCH sets the status; the status filter follows', async () => {
      const [row] = await feedback.find({
        where: { userId: member.id, type: 'idea' },
      });

      const res = await request(http)
        .patch(`/admin/feedback/${row.id}`)
        .set(auth(admin))
        .send({ status: 'reviewed' })
        .expect(200);
      expect(res.body).toMatchObject({ id: row.id, status: 'reviewed' });

      const reviewed = await request(http)
        .get('/admin/feedback')
        .query({ user_id: member.id, status: 'reviewed' })
        .set(auth(admin))
        .expect(200);
      expect(reviewed.body.items.map((f: { id: string }) => f.id)).toEqual([
        row.id,
      ]);

      await request(http)
        .patch(`/admin/feedback/${row.id}`)
        .set(auth(admin))
        .send({ status: 'done' })
        .expect(400);
      await request(http)
        .patch(`/admin/feedback/${randomUUID()}`)
        .set(auth(admin))
        .send({ status: 'archived' })
        .expect(404);
    });

    it('counts untriaged feedback in the stats overview', async () => {
      const res = await request(http)
        .get('/admin/stats/overview')
        .set(auth(admin))
        .expect(200);
      expect(res.body.totals.feedback_new).toBeGreaterThanOrEqual(1);
    });
  });
});
