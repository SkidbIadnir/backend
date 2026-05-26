import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

class TestPushDto {
  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;
}

interface AuthRequest extends Request {
  user: { sub: string; discordId: string };
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Send a one-off test push.
   *
   * - If `token` is provided in the body: sends to that token directly (useful
   *   for testing with a browser token before the app is built).
   * - If `token` is omitted: sends to the push token stored for the currently
   *   logged-in user (requires a prior POST /auth/device-token call).
   *
   * Returns whether Firebase is configured and whether the send succeeded.
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testPush(
    @Req() req: AuthRequest,
    @Body() dto: TestPushDto,
  ): Promise<{ firebaseEnabled: boolean; success: boolean; error?: string }> {
    if (!this.notificationsService.isEnabled) {
      return { firebaseEnabled: false, success: false, error: 'Firebase env vars not set' };
    }

    let targetToken: string | undefined = dto.token;

    if (!targetToken) {
      // Fall back to the stored token for this user
      const stored = await this.notificationsService.getStoredToken(req.user.sub);
      if (!stored) {
        return {
          firebaseEnabled: true,
          success: false,
          error: 'No token provided and no push token stored for this user. Call POST /auth/device-token first, or pass a token in the request body.',
        };
      }
      targetToken = stored;
    }

    const result = await this.notificationsService.sendPush(
      targetToken,
      dto.title ?? '🥃 Test notification',
      dto.body ?? 'Firebase is wired up correctly!',
    );

    return { firebaseEnabled: true, ...result };
  }

  /**
   * Simulate a scraper run for the logged-in user: checks all their active
   * alerts against the current live whisky inventory and sends push
   * notifications for any matches. Useful to verify end-to-end matching
   * without waiting for the scheduled scraper.
   */
  @Post('test-match')
  @HttpCode(HttpStatus.OK)
  async testMatch(
    @Req() req: AuthRequest,
  ): Promise<{ firebaseEnabled: boolean; matchCount: number }> {
    const matchCount = await this.notificationsService.testMatchForUser(
      req.user.discordId,
    );
    return { firebaseEnabled: this.notificationsService.isEnabled, matchCount };
  }
}
