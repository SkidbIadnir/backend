import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasteepJwtAuthGuard } from '../tasteep/auth/tasteep-jwt-auth.guard';
import type { TasteepAuthRequest } from '../tasteep/auth/tasteep-jwt-auth.guard';
import { TasteepUser } from '../tasteep/entities/tasteep-user.entity';
import { TasteepSession } from '../tasteep/entities/tasteep-session.entity';
import { adminConfig } from './admin-config';

export interface AdminAuthRequest extends TasteepAuthRequest {
  admin: { userId: string; sessionId: string; email: string };
}

/**
 * A Tasteep bearer token whose account email is on `ADMIN_EMAILS`, and whose
 * session was created recently. The age check means a long-lived mobile token
 * can't double as a standing admin credential — admins sign in again.
 */
@Injectable()
export class AdminGuard extends TasteepJwtAuthGuard {
  constructor(
    @InjectRepository(TasteepUser)
    private readonly userRepo: Repository<TasteepUser>,
    @InjectRepository(TasteepSession)
    private readonly sessionRepo: Repository<TasteepSession>,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Verifies the JWT and that the session is neither revoked nor expired.
    if (!(await super.canActivate(context))) return false;

    const req = context.switchToHttp().getRequest<AdminAuthRequest>();
    const { sub, sid } = req.user;

    const user = await this.userRepo.findOne({ where: { id: sub } });
    const email = user?.email?.toLowerCase();
    if (!email || !adminConfig.emails.includes(email)) {
      throw new ForbiddenException('Admin access required.');
    }

    const session = await this.sessionRepo.findOne({ where: { id: sid } });
    const maxAgeMs = adminConfig.sessionMaxHours * 60 * 60 * 1000;
    if (!session || Date.now() - session.createdAt.getTime() > maxAgeMs) {
      throw new UnauthorizedException('Admin session expired — sign in again.');
    }

    req.admin = { userId: sub, sessionId: sid, email };
    return true;
  }
}
