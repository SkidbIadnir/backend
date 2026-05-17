import { Controller, Delete, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('discord')
  redirectToDiscord(@Res() res: Response) {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID as string,
      redirect_uri: `${process.env.APP_URL}/auth/discord/callback`,
      response_type: 'code',
      scope: 'identify',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  }

  @Get('discord/callback')
  async discordCallback(@Query('code') code: string, @Res() res: Response) {
    const { token } = await this.authService.exchangeDiscordCode(code);
    res.redirect(`tasteep://callback?token=${token}`);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request & { user: { sub: string } }) {
    return this.authService.getMe(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('discord')
  disconnect(@Req() req: Request & { user: { sub: string } }) {
    return this.authService.deleteUser(req.user.sub);
  }
}
