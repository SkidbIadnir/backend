import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { TasteepAuthService } from './tasteep-auth.service';
import { TasteepJwtAuthGuard } from './tasteep-jwt-auth.guard';
import type { TasteepAuthRequest } from './tasteep-jwt-auth.guard';
import { DiscordOAuthService } from './discord-oauth.service';
import {
  DiscordLoginDto,
  GoogleLoginDto,
  RequestEmailCodeDto,
  VerifyEmailCodeDto,
} from './dto/auth.dto';

/**
 * Tasteep authentication. Paths match `lib/services/api/api_config.dart`.
 * Every success response is an `AuthUser` JSON object (no envelope).
 */
@Controller('auth')
export class TasteepAuthController {
  constructor(
    private readonly authService: TasteepAuthService,
    private readonly discordOAuth: DiscordOAuthService,
  ) {}

  /** Step 1 of email login: sends a 6-digit code. */
  @Post('email')
  @HttpCode(HttpStatus.OK)
  requestEmailCode(@Body() dto: RequestEmailCodeDto) {
    return this.authService.requestEmailCode(dto.email);
  }

  /** Step 2 of email login: exchanges the code for an AuthUser + bearer token. */
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmailCode(@Body() dto: VerifyEmailCodeDto) {
    return this.authService.verifyEmailCode(dto.email, dto.code);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  google(@Body() dto: GoogleLoginDto) {
    return this.authService.loginWithGoogle(dto.id_token);
  }

  /** Convenience: sends the browser to Discord's consent page with the server's configured redirect URI. */
  @Get('discord')
  redirectToDiscord(
    @Res() res: Response,
    @Query('redirect_uri') redirectUri?: string,
  ) {
    res.redirect(this.discordOAuth.buildAuthorizeUrl(redirectUri));
  }

  @Post('discord')
  @HttpCode(HttpStatus.OK)
  discord(@Body() dto: DiscordLoginDto) {
    return this.authService.loginWithDiscord(dto.code, dto.redirect_uri);
  }

  @UseGuards(TasteepJwtAuthGuard)
  @Get('me')
  me(@Req() req: TasteepAuthRequest) {
    return this.authService.getMe(req.user.sub);
  }

  @UseGuards(TasteepJwtAuthGuard)
  @Post('signout')
  @HttpCode(HttpStatus.NO_CONTENT)
  signOut(@Req() req: TasteepAuthRequest) {
    return this.authService.signOut(req.user.sid, req.user.sub);
  }
}
