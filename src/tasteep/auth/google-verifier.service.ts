import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import type { TokenPayload } from 'google-auth-library';
import { tasteepConfig } from '../tasteep-config';

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** Verifies Google ID tokens produced by the client's `google_sign_in` flow. */
@Injectable()
export class GoogleVerifierService {
  private readonly client = new OAuth2Client();

  async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    const audience = tasteepConfig.googleClientIds;
    if (audience.length === 0) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured on the server.',
      );
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google token.');
    }
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid Google token.');
    }

    return {
      sub: payload.sub,
      email: payload.email ?? null,
      emailVerified: payload.email_verified === true,
      name: payload.name ?? null,
    };
  }
}
