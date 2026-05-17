import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { User } from '../users/user.entity';

interface DiscordTokenResponse {
  access_token: string;
}

interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly httpService: HttpService,
  ) {}

  async exchangeDiscordCode(code: string) {
    const redirectUri = `${process.env.APP_URL}/auth/discord/callback`;

    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID as string,
      client_secret: process.env.DISCORD_CLIENT_SECRET as string,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    const { data: tokenData } = await firstValueFrom(
      this.httpService.post<DiscordTokenResponse>(
        'https://discord.com/api/oauth2/token',
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      ),
    );

    const { data: discordUser } = await firstValueFrom(
      this.httpService.get<DiscordUser>('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      }),
    );

    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
      : null;

    let user = await this.userRepo.findOne({
      where: { discordId: discordUser.id },
    });

    if (!user) {
      user = this.userRepo.create({
        discordId: discordUser.id,
        username: discordUser.username,
        avatarUrl,
      });
    } else {
      Object.assign(user, { username: discordUser.username, avatarUrl });
    }

    const saved = await this.userRepo.save(user);
    return { token: this.jwtService.sign({ sub: saved.id }), user: saved };
  }

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return { discordId: user.discordId, username: user.username, avatarUrl: user.avatarUrl };
  }

  async deleteUser(userId: string): Promise<void> {
    await this.userRepo.delete({ id: userId });
  }
}
