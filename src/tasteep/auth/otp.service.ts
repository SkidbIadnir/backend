import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { TasteepEmailOtp } from '../entities/tasteep-email-otp.entity';
import { tasteepConfig } from '../tasteep-config';

export class OtpCooldownException extends HttpException {
  constructor(retryAfterSeconds: number) {
    super(
      {
        message:
          'A code was sent recently. Please wait before requesting another.',
        retry_after: retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Issues and verifies 6-digit email codes. Codes are stored as an HMAC keyed on
 * the JWT secret, expire after a few minutes, and lock after N wrong attempts.
 */
@Injectable()
export class OtpService {
  constructor(
    @InjectRepository(TasteepEmailOtp)
    private readonly otpRepo: Repository<TasteepEmailOtp>,
  ) {}

  /** Creates a fresh code for `email`, invalidating any previous one. Returns the plain code to send. */
  async issue(
    email: string,
    now: Date = new Date(),
  ): Promise<{ code: string; expiresAt: Date }> {
    const latest = await this.otpRepo.findOne({
      where: { email, consumedAt: IsNull(), expiresAt: MoreThan(now) },
      order: { createdAt: 'DESC' },
    });
    if (latest) {
      const elapsed = (now.getTime() - latest.createdAt.getTime()) / 1000;
      const cooldown = tasteepConfig.otpResendCooldownSeconds;
      if (elapsed < cooldown) {
        throw new OtpCooldownException(Math.ceil(cooldown - elapsed));
      }
    }

    // One live code per address: retire the older ones.
    await this.otpRepo.update(
      { email, consumedAt: IsNull() },
      { consumedAt: now },
    );

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(
      now.getTime() + tasteepConfig.otpTtlMinutes * 60_000,
    );
    await this.otpRepo.save(
      this.otpRepo.create({
        email,
        codeHash: this.hash(email, code),
        attempts: 0,
        expiresAt,
      }),
    );
    return { code, expiresAt };
  }

  /** Throws `UnauthorizedException` unless `code` matches the live code for `email`. Consumes it on success. */
  async verify(
    email: string,
    code: string,
    now: Date = new Date(),
  ): Promise<void> {
    const otp = await this.otpRepo.findOne({
      where: { email, consumedAt: IsNull(), expiresAt: MoreThan(now) },
      order: { createdAt: 'DESC' },
    });
    if (!otp) {
      throw new UnauthorizedException(
        'No valid code for this email. Request a new one.',
      );
    }
    if (otp.attempts >= tasteepConfig.otpMaxAttempts) {
      throw new UnauthorizedException(
        'Too many wrong attempts. Request a new code.',
      );
    }

    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hash(email, code), 'hex');
    const matches =
      expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      otp.attempts += 1;
      await this.otpRepo.save(otp);
      throw new UnauthorizedException('Invalid code.');
    }

    otp.consumedAt = now;
    await this.otpRepo.save(otp);
  }

  private hash(email: string, code: string): string {
    return createHmac('sha256', tasteepConfig.jwtSecret)
      .update(`${email}:${code}`)
      .digest('hex');
  }
}
