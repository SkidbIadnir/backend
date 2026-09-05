process.env.TASTEEP_JWT_SECRET = 'test-secret';
process.env.TASTEEP_JWT_EXPIRES_IN = '365d';

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { IsNull } from 'typeorm';
import {
  displayNameFromEmail,
  durationToMs,
  TasteepAuthService,
} from './tasteep-auth.service';
import { TasteepUser } from '../entities/tasteep-user.entity';
import { TasteepSession } from '../entities/tasteep-session.entity';
import { OtpService } from './otp.service';
import { GoogleVerifierService } from './google-verifier.service';
import { DiscordOAuthService } from './discord-oauth.service';
import { TasteepMailService } from '../mail/tasteep-mail.service';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';
import {
  makeSession,
  makeTasteepUser,
  SESSION_ID,
  USER_ID,
} from '../test-utils/fixtures';

describe('TasteepAuthService', () => {
  let service: TasteepAuthService;
  let userRepo: MockRepository<TasteepUser>;
  let sessionRepo: MockRepository<TasteepSession>;
  let jwt: { sign: jest.Mock };
  let otp: { issue: jest.Mock; verify: jest.Mock };
  let google: { verifyIdToken: jest.Mock };
  let discord: { exchangeCode: jest.Mock };
  let mail: { sendOtp: jest.Mock };

  beforeEach(async () => {
    userRepo = createMockRepository<TasteepUser>();
    sessionRepo = createMockRepository<TasteepSession>();
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt') };
    otp = { issue: jest.fn(), verify: jest.fn().mockResolvedValue(undefined) };
    google = { verifyIdToken: jest.fn() };
    discord = { exchangeCode: jest.fn() };
    mail = { sendOtp: jest.fn().mockResolvedValue(undefined) };

    userRepo.save!.mockImplementation(async (u: TasteepUser) => ({
      ...u,
      id: u.id ?? USER_ID,
    }));
    sessionRepo.save!.mockImplementation(async (s: TasteepSession) => ({
      ...s,
      id: s.id ?? SESSION_ID,
    }));

    const module = await Test.createTestingModule({
      providers: [
        TasteepAuthService,
        { provide: getRepositoryToken(TasteepUser), useValue: userRepo },
        { provide: getRepositoryToken(TasteepSession), useValue: sessionRepo },
        { provide: JwtService, useValue: jwt },
        { provide: OtpService, useValue: otp },
        { provide: GoogleVerifierService, useValue: google },
        { provide: DiscordOAuthService, useValue: discord },
        { provide: TasteepMailService, useValue: mail },
      ],
    }).compile();
    service = module.get(TasteepAuthService);
  });

  describe('email flow', () => {
    it('requestEmailCode issues a code and emails it', async () => {
      otp.issue.mockResolvedValue({
        code: '123456',
        expiresAt: new Date(Date.now() + 600_000),
      });
      const result = await service.requestEmailCode('nina@example.com');
      expect(mail.sendOtp).toHaveBeenCalledWith(
        'nina@example.com',
        '123456',
        expect.any(Number),
      );
      expect(result.status).toBe('code_sent');
      expect(result.expires_in).toBeGreaterThan(590);
    });

    it('verifyEmailCode creates the account on first login and returns AuthUser with a token', async () => {
      userRepo.findOne!.mockResolvedValue(null);

      const result = await service.verifyEmailCode(
        'nina@example.com',
        '123456',
      );

      expect(otp.verify).toHaveBeenCalledWith('nina@example.com', '123456');
      expect(userRepo.create).toHaveBeenCalledWith({
        provider: 'email',
        providerId: 'nina@example.com',
        email: 'nina@example.com',
        displayName: 'nina',
      });
      expect(sessionRepo.save).toHaveBeenCalled();
      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: USER_ID, sid: SESSION_ID },
        { expiresIn: '365d' },
      );
      expect(result).toEqual({
        id: USER_ID,
        display_name: 'nina',
        provider: 'email',
        email: 'nina@example.com',
        token: 'signed.jwt',
      });
    });

    it('verifyEmailCode reuses the existing account', async () => {
      userRepo.findOne!.mockResolvedValue(makeTasteepUser());
      await service.verifyEmailCode('nina@example.com', '123456');
      expect(userRepo.create).not.toHaveBeenCalled();
    });

    it('propagates a failed verification without touching users', async () => {
      otp.verify.mockRejectedValue(new Error('Invalid code.'));
      await expect(
        service.verifyEmailCode('nina@example.com', '000000'),
      ).rejects.toThrow('Invalid code.');
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('google', () => {
    it('signs into the existing email account when the verified Google email matches', async () => {
      google.verifyIdToken.mockResolvedValue({
        sub: 'g-123',
        email: 'Nina@Example.com',
        emailVerified: true,
        name: 'Nina',
      });
      const existing = makeTasteepUser({ provider: 'email' });
      userRepo
        .findOne!.mockResolvedValueOnce(null) // by (google, g-123)
        .mockResolvedValueOnce(existing); // by email

      const result = await service.loginWithGoogle('id.token');

      expect(userRepo.findOne).toHaveBeenNthCalledWith(2, {
        where: { email: 'nina@example.com' },
      });
      expect(userRepo.create).not.toHaveBeenCalled();
      expect(result.provider).toBe('email');
      expect(result.token).toBe('signed.jwt');
    });

    it('ignores an unverified Google email for matching and stores null', async () => {
      google.verifyIdToken.mockResolvedValue({
        sub: 'g-1',
        email: 'x@y.z',
        emailVerified: false,
        name: null,
      });
      userRepo.findOne!.mockResolvedValue(null);

      await service.loginWithGoogle('id.token');

      expect(userRepo.findOne).toHaveBeenCalledTimes(1);
      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          providerId: 'g-1',
          email: null,
          displayName: 'Google user',
        }),
      );
    });
  });

  describe('discord', () => {
    it('creates a discord account using global_name and forwards redirect_uri', async () => {
      discord.exchangeCode.mockResolvedValue({
        id: 'd-9',
        username: 'skid',
        globalName: 'Skid',
        email: 'skid@example.com',
        emailVerified: true,
      });
      userRepo.findOne!.mockResolvedValue(null);

      const result = await service.loginWithDiscord(
        'the-code',
        'tasteep://auth/discord',
      );

      expect(discord.exchangeCode).toHaveBeenCalledWith(
        'the-code',
        'tasteep://auth/discord',
      );
      expect(userRepo.create).toHaveBeenCalledWith({
        provider: 'discord',
        providerId: 'd-9',
        email: 'skid@example.com',
        displayName: 'Skid',
      });
      expect(result.display_name).toBe('Skid');
    });
  });

  describe('sessions', () => {
    it('getMe returns the AuthUser without a token', async () => {
      userRepo.findOne!.mockResolvedValue(makeTasteepUser());
      expect(await service.getMe(USER_ID)).toMatchObject({
        id: USER_ID,
        token: null,
      });
    });

    it('isSessionActive is true for a live session and refreshes last_seen_at when stale', async () => {
      sessionRepo.findOne!.mockResolvedValue(
        makeSession({ lastSeenAt: new Date('2026-01-01T00:00:00Z') }),
      );
      expect(
        await service.isSessionActive(
          SESSION_ID,
          USER_ID,
          new Date('2026-06-01T00:00:00Z'),
        ),
      ).toBe(true);
      expect(sessionRepo.update).toHaveBeenCalledWith(
        { id: SESSION_ID },
        { lastSeenAt: new Date('2026-06-01T00:00:00Z') },
      );
    });

    it('isSessionActive does not write when last_seen_at is recent', async () => {
      const now = new Date('2026-06-01T00:30:00Z');
      sessionRepo.findOne!.mockResolvedValue(
        makeSession({ lastSeenAt: new Date('2026-06-01T00:00:00Z') }),
      );
      expect(await service.isSessionActive(SESSION_ID, USER_ID, now)).toBe(
        true,
      );
      expect(sessionRepo.update).not.toHaveBeenCalled();
    });

    it('isSessionActive is false when revoked, expired, or missing', async () => {
      sessionRepo.findOne!.mockResolvedValueOnce(
        makeSession({ revokedAt: new Date() }),
      );
      expect(await service.isSessionActive(SESSION_ID, USER_ID)).toBe(false);

      sessionRepo.findOne!.mockResolvedValueOnce(
        makeSession({ expiresAt: new Date('2020-01-01') }),
      );
      expect(await service.isSessionActive(SESSION_ID, USER_ID)).toBe(false);

      sessionRepo.findOne!.mockResolvedValueOnce(null);
      expect(await service.isSessionActive(SESSION_ID, USER_ID)).toBe(false);
    });

    it("signOut revokes only the caller's own session", async () => {
      await service.signOut(SESSION_ID, USER_ID);
      expect(sessionRepo.update).toHaveBeenCalledWith(
        { id: SESSION_ID, userId: USER_ID, revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
    });
  });

  describe('helpers', () => {
    it('durationToMs parses the supported units', () => {
      expect(durationToMs('365d')).toBe(365 * 86_400_000);
      expect(durationToMs('12h')).toBe(43_200_000);
      expect(durationToMs('30m')).toBe(1_800_000);
      expect(durationToMs('45s')).toBe(45_000);
      expect(durationToMs('90')).toBe(90_000);
      expect(() => durationToMs('1 week')).toThrow();
    });

    it('displayNameFromEmail uses the local part', () => {
      expect(displayNameFromEmail('nina.j@example.com')).toBe('nina.j');
    });
  });
});
