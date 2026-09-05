process.env.TASTEEP_JWT_SECRET = 'test-secret';
process.env.TASTEEP_OTP_MAX_ATTEMPTS = '3';
process.env.TASTEEP_OTP_RESEND_COOLDOWN_SECONDS = '60';
process.env.TASTEEP_OTP_TTL_MINUTES = '10';

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { OtpCooldownException, OtpService } from './otp.service';
import { TasteepEmailOtp } from '../entities/tasteep-email-otp.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';

const EMAIL = 'nina@example.com';
const NOW = new Date('2026-05-01T10:00:00Z');

describe('OtpService', () => {
  let service: OtpService;
  let repo: MockRepository<TasteepEmailOtp>;

  beforeEach(async () => {
    repo = createMockRepository<TasteepEmailOtp>();
    repo.save!.mockImplementation(async (row: TasteepEmailOtp) => row);
    const module = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: getRepositoryToken(TasteepEmailOtp), useValue: repo },
      ],
    }).compile();
    service = module.get(OtpService);
  });

  describe('issue', () => {
    it('stores a hashed 6-digit code with a 10 minute expiry and retires older codes', async () => {
      repo.findOne!.mockResolvedValue(null);

      const { code, expiresAt } = await service.issue(EMAIL, NOW);

      expect(code).toMatch(/^\d{6}$/);
      expect(expiresAt).toEqual(new Date('2026-05-01T10:10:00Z'));
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ email: EMAIL }),
        { consumedAt: NOW },
      );
      const saved = repo.save!.mock.calls[0][0] as TasteepEmailOtp;
      expect(saved.email).toBe(EMAIL);
      expect(saved.codeHash).not.toContain(code);
      expect(saved.codeHash).toHaveLength(64);
    });

    it('rejects with 429 while the previous code is inside the cooldown', async () => {
      repo.findOne!.mockResolvedValue({
        createdAt: new Date('2026-05-01T09:59:30Z'),
      });

      const promise = service.issue(EMAIL, NOW);
      await expect(promise).rejects.toBeInstanceOf(OtpCooldownException);
      await promise.catch((e: OtpCooldownException) => {
        expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(e.getResponse()).toMatchObject({ retry_after: 30 });
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('issues again once the cooldown has passed', async () => {
      repo.findOne!.mockResolvedValue({
        createdAt: new Date('2026-05-01T09:58:00Z'),
      });
      await expect(service.issue(EMAIL, NOW)).resolves.toBeDefined();
    });
  });

  describe('verify', () => {
    const issueThenFetch = async () => {
      repo.findOne!.mockResolvedValue(null);
      const { code } = await service.issue(EMAIL, NOW);
      const row = repo.save!.mock.calls[0][0] as TasteepEmailOtp;
      row.attempts = 0;
      row.consumedAt = null;
      repo.findOne!.mockResolvedValue(row);
      repo.save!.mockClear();
      return { code, row };
    };

    it('consumes the code on a match', async () => {
      const { code, row } = await issueThenFetch();
      await service.verify(EMAIL, code, NOW);
      expect(row.consumedAt).toEqual(NOW);
      expect(repo.save).toHaveBeenCalledWith(row);
    });

    it('counts a wrong attempt and throws 401', async () => {
      const { code, row } = await issueThenFetch();
      const wrong = code === '000000' ? '000001' : '000000';
      await expect(service.verify(EMAIL, wrong, NOW)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(row.attempts).toBe(1);
      expect(row.consumedAt).toBeNull();
    });

    it('locks after the maximum number of attempts', async () => {
      const { code, row } = await issueThenFetch();
      row.attempts = 3;
      await expect(service.verify(EMAIL, code, NOW)).rejects.toThrow(
        /Too many/,
      );
    });

    it('rejects when no live code exists', async () => {
      repo.findOne!.mockResolvedValue(null);
      await expect(service.verify(EMAIL, '123456', NOW)).rejects.toThrow(
        /Request a new one/,
      );
    });
  });
});
