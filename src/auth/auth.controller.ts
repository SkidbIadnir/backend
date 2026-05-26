import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { IsNotEmpty, IsString } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

class DeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

interface AuthRequest extends Request {
  user: { sub: string; discordId: string };
}

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
  me(@Req() req: AuthRequest) {
    return this.authService.getMe(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('device-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  registerDeviceToken(@Req() req: AuthRequest, @Body() dto: DeviceTokenDto) {
    return this.authService.registerDeviceToken(req.user.sub, dto.token);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('device-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearDeviceToken(@Req() req: AuthRequest) {
    return this.authService.clearDeviceToken(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('discord')
  disconnect(@Req() req: AuthRequest) {
    return this.authService.deleteUser(req.user.sub);
  }
}
