import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { AuthProvider, TasteepUser } from '../entities/tasteep-user.entity';
import { TasteepSession } from '../entities/tasteep-session.entity';
import { OtpService } from './otp.service';
import { GoogleVerifierService } from './google-verifier.service';
import { DiscordOAuthService } from './discord-oauth.service';
import { TasteepMailService } from '../mail/tasteep-mail.service';
import { tasteepConfig } from '../tasteep-config';
import { AuthUserJson, toAuthUserJson } from './auth-user';

interface IdentityInput {
  provider: AuthProvider;
  providerId: string;
  /** Only pass an email the provider has verified; it is used for account matching. */
  email: string | null;
  displayName: string;
}

/** How often `last_seen_at` is refreshed at most — avoids a write per request. */
const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000;

@Injectable()
export class TasteepAuthService {
  private readonly logger = new Logger(TasteepAuthService.name);

  constructor(
    @InjectRepository(TasteepUser)
    private readonly userRepo: Repository<TasteepUser>,
    @InjectRepository(TasteepSession)
    private readonly sessionRepo: Repository<TasteepSession>,
    private readonly jwtService: JwtService,
    private readonly otpService: OtpService,
    private readonly googleVerifier: GoogleVerifierService,
    private readonly discordOAuth: DiscordOAuthService,
    private readonly mail: TasteepMailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Email OTP
  // ---------------------------------------------------------------------------

  async requestEmailCode(
    email: string,
  ): Promise<{ status: 'code_sent'; email: string; expires_in: number }> {
    const { code, expiresAt } = await this.otpService.issue(email);
    await this.mail.sendOtp(email, code, tasteepConfig.otpTtlMinutes);
    return {
      status: 'code_sent',
      email,
      expires_in: Math.round((expiresAt.getTime() - Date.now()) / 1000),
    };
  }

  async verifyEmailCode(email: string, code: string): Promise<AuthUserJson> {
    await this.otpService.verify(email, code);
    const user = await this.findOrCreateUser({
      provider: 'email',
      providerId: email,
      email,
      displayName: displayNameFromEmail(email),
    });
    return this.issueSession(user);
  }

  // ---------------------------------------------------------------------------
  // OAuth
  // ---------------------------------------------------------------------------

  async loginWithGoogle(idToken: string): Promise<AuthUserJson> {
    const identity = await this.googleVerifier.verifyIdToken(idToken);
    const email = identity.emailVerified
      ? (identity.email?.toLowerCase() ?? null)
      : null;
    const user = await this.findOrCreateUser({
      provider: 'google',
      providerId: identity.sub,
      email,
      displayName:
        identity.name ?? (email ? displayNameFromEmail(email) : 'Google user'),
    });
    return this.issueSession(user);
  }

  async loginWithDiscord(
    code: string,
    redirectUri?: string,
  ): Promise<AuthUserJson> {
    const identity = await this.discordOAuth.exchangeCode(code, redirectUri);
    const email = identity.emailVerified
      ? (identity.email?.toLowerCase() ?? null)
      : null;
    const user = await this.findOrCreateUser({
      provider: 'discord',
      providerId: identity.id,
      email,
      displayName: identity.globalName ?? identity.username,
    });
    return this.issueSession(user);
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async getMe(userId: string): Promise<AuthUserJson> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    return toAuthUserJson(user);
  }

  async signOut(sessionId: string, userId: string): Promise<void> {
    // Note: never put `undefined` in update criteria — TypeORM renders it as `= NULL`, which matches nothing.
    await this.sessionRepo.update(
      { id: sessionId, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Called by the JWT strategy on every authenticated request. */
  async isSessionActive(
    sessionId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now.getTime()
    ) {
      return false;
    }
    const lastSeen = session.lastSeenAt?.getTime() ?? 0;
    if (now.getTime() - lastSeen > LAST_SEEN_REFRESH_MS) {
      await this.sessionRepo.update({ id: sessionId }, { lastSeenAt: now });
    }
    return true;
  }

  private async issueSession(user: TasteepUser): Promise<AuthUserJson> {
    const expiresIn = tasteepConfig.jwtExpiresIn;
    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        userId: user.id,
        expiresAt: new Date(Date.now() + durationToMs(expiresIn)),
        revokedAt: null,
        lastSeenAt: new Date(),
      }),
    );
    const token = this.jwtService.sign(
      { sub: user.id, sid: session.id },
      { expiresIn: expiresIn as JwtSignOptions['expiresIn'] },
    );
    return toAuthUserJson(user, token);
  }

  // ---------------------------------------------------------------------------
  // Account resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolution order:
   *  1. exact (provider, provider_id) match → that account (email refreshed if newly known)
   *  2. a verified email already owned by another account → that account (cross-provider login)
   *  3. otherwise a brand-new account
   */
  private async findOrCreateUser(input: IdentityInput): Promise<TasteepUser> {
    const byProvider = await this.userRepo.findOne({
      where: { provider: input.provider, providerId: input.providerId },
    });
    if (byProvider) {
      if (input.email && byProvider.email !== input.email) {
        const emailOwner = await this.userRepo.findOne({
          where: { email: input.email },
        });
        if (!emailOwner) {
          byProvider.email = input.email;
          return this.userRepo.save(byProvider);
        }
      }
      return byProvider;
    }

    if (input.email) {
      const byEmail = await this.userRepo.findOne({
        where: { email: input.email },
      });
      if (byEmail) {
        this.logger.log(
          `Signing ${input.provider} login into existing account ${byEmail.id} via email match`,
        );
        return byEmail;
      }
    }

    return this.userRepo.save(
      this.userRepo.create({
        provider: input.provider,
        providerId: input.providerId,
        email: input.email,
        displayName: input.displayName,
      }),
    );
  }
}

export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.length > 0 ? local : email;
}

/** Parses `365d`, `12h`, `30m`, `45s` or plain seconds into milliseconds. */
export function durationToMs(value: string): number {
  const match = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported duration: ${value}`);
  const n = parseInt(match[1], 10);
  const unit = match[2] || 's';
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    unit
  ] as number;
  return n * factor;
}
