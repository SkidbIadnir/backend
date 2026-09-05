import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { TASTEEP_JWT_AUDIENCE, tasteepConfig } from '../tasteep-config';
import { TasteepAuthService } from './tasteep-auth.service';

export const TASTEEP_JWT_STRATEGY = 'tasteep-jwt';

export interface TasteepJwtPayload {
  /** user id */
  sub: string;
  /** session id — looked up on every request so sign-out really revokes */
  sid: string;
}

@Injectable()
export class TasteepJwtStrategy extends PassportStrategy(
  Strategy,
  TASTEEP_JWT_STRATEGY,
) {
  constructor(private readonly authService: TasteepAuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: tasteepConfig.jwtSecret,
      audience: TASTEEP_JWT_AUDIENCE,
    });
  }

  async validate(payload: TasteepJwtPayload): Promise<TasteepJwtPayload> {
    if (!payload?.sub || !payload?.sid) {
      throw new UnauthorizedException('Malformed token.');
    }
    const alive = await this.authService.isSessionActive(
      payload.sid,
      payload.sub,
    );
    if (!alive) {
      throw new UnauthorizedException(
        'Session expired or signed out. Please log in again.',
      );
    }
    return { sub: payload.sub, sid: payload.sid };
  }
}
