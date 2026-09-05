import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { tasteepConfig } from '../tasteep-config';

export interface DiscordIdentity {
  id: string;
  username: string;
  globalName: string | null;
  email: string | null;
  emailVerified: boolean;
}

interface DiscordTokenResponse {
  access_token: string;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  global_name?: string | null;
  email?: string | null;
  verified?: boolean;
}

/**
 * Server-side authorization-code exchange for Discord. The mobile app opens the
 * Discord authorize page, catches the `code` on its registered redirect URI and
 * hands it here; the client secret never leaves the server.
 */
@Injectable()
export class DiscordOAuthService {
  constructor(private readonly httpService: HttpService) {}

  buildAuthorizeUrl(redirectUri = tasteepConfig.discordRedirectUri): string {
    const clientId = tasteepConfig.discordClientId;
    if (!clientId || !redirectUri) {
      throw new ServiceUnavailableException(
        'Discord sign-in is not configured on the server.',
      );
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify email',
    });
    return `https://discord.com/oauth2/authorize?${params}`;
  }

  async exchangeCode(
    code: string,
    redirectUri?: string,
  ): Promise<DiscordIdentity> {
    const clientId = tasteepConfig.discordClientId;
    const clientSecret = tasteepConfig.discordClientSecret;
    const finalRedirect = redirectUri ?? tasteepConfig.discordRedirectUri;
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'Discord sign-in is not configured on the server.',
      );
    }
    if (!finalRedirect) {
      throw new BadRequestException('redirect_uri is required.');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: finalRedirect,
    });

    let accessToken: string;
    try {
      const { data } = await firstValueFrom(
        this.httpService.post<DiscordTokenResponse>(
          'https://discord.com/api/oauth2/token',
          params.toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        ),
      );
      accessToken = data.access_token;
    } catch {
      throw new UnauthorizedException('Discord code exchange failed.');
    }

    const { data: user } = await firstValueFrom(
      this.httpService.get<DiscordUserResponse>(
        'https://discord.com/api/users/@me',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      ),
    );

    return {
      id: user.id,
      username: user.username,
      globalName: user.global_name ?? null,
      email: user.email ?? null,
      emailVerified: user.verified === true,
    };
  }
}
