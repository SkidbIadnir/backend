import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { TasteepJwtAuthGuard } from '../tasteep/auth/tasteep-jwt-auth.guard';
import {
  createMockRepository,
  MockRepository,
} from '../test-utils/mock-repository.factory';
import {
  makeSession,
  makeTasteepUser,
  SESSION_ID,
  USER_ID,
} from '../tasteep/test-utils/fixtures';
import { TasteepSession } from '../tasteep/entities/tasteep-session.entity';
import { TasteepUser } from '../tasteep/entities/tasteep-user.entity';
import { AdminGuard } from './admin-auth.guard';

describe('AdminGuard', () => {
  let guard: AdminGuard;
  let userRepo: MockRepository<TasteepUser>;
  let sessionRepo: MockRepository<TasteepSession>;
  let jwtCheck: jest.SpyInstance;
  let req: Record<string, unknown>;
  let ctx: ExecutionContext;

  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'Admin@Example.com, other@example.com';
    delete process.env.ADMIN_SESSION_MAX_HOURS;
    userRepo = createMockRepository<TasteepUser>();
    sessionRepo = createMockRepository<TasteepSession>();
    guard = new AdminGuard(userRepo as never, sessionRepo as never);
    // The JWT + live-session check belongs to the Tasteep guard; this spec is about the admin rules on top.
    jwtCheck = jest
      .spyOn(TasteepJwtAuthGuard.prototype, 'canActivate')
      .mockResolvedValue(true);
    req = { user: { sub: USER_ID, sid: SESSION_ID } };
    ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    userRepo.findOne!.mockResolvedValue(
      makeTasteepUser({ email: 'admin@example.com' }),
    );
    sessionRepo.findOne!.mockResolvedValue(
      makeSession({ createdAt: new Date() }),
    );
  });

  afterEach(() => {
    jwtCheck.mockRestore();
    delete process.env.ADMIN_EMAILS;
  });

  it('lets an allowlisted admin through (case-insensitive) and records who they are', async () => {
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.admin).toEqual({
      userId: USER_ID,
      sessionId: SESSION_ID,
      email: 'admin@example.com',
    });
  });

  it('returns false without touching the DB when the JWT check fails', async () => {
    jwtCheck.mockResolvedValue(false);
    await expect(guard.canActivate(ctx)).resolves.toBe(false);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });

  it('403s a signed-in user whose email is not on the allowlist', async () => {
    userRepo.findOne!.mockResolvedValue(
      makeTasteepUser({ email: 'someone@example.com' }),
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403s a user with no email', async () => {
    userRepo.findOne!.mockResolvedValue(makeTasteepUser({ email: null }));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('fails closed when ADMIN_EMAILS is unset', async () => {
    delete process.env.ADMIN_EMAILS;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('401s an admin whose session is older than ADMIN_SESSION_MAX_HOURS', async () => {
    sessionRepo.findOne!.mockResolvedValue(
      makeSession({ createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000) }),
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('honours a custom ADMIN_SESSION_MAX_HOURS', async () => {
    process.env.ADMIN_SESSION_MAX_HOURS = '24';
    sessionRepo.findOne!.mockResolvedValue(
      makeSession({ createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000) }),
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
