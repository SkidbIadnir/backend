import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { HttpModule } from '@nestjs/axios';
import { TasteepUser } from '../entities/tasteep-user.entity';
import { TasteepSession } from '../entities/tasteep-session.entity';
import { TasteepEmailOtp } from '../entities/tasteep-email-otp.entity';
import { TasteepMailModule } from '../mail/tasteep-mail.module';
import { TASTEEP_JWT_AUDIENCE, tasteepConfig } from '../tasteep-config';
import { TasteepAuthService } from './tasteep-auth.service';
import { TasteepAuthController } from './tasteep-auth.controller';
import { TasteepJwtStrategy } from './tasteep-jwt.strategy';
import { OtpService } from './otp.service';
import { GoogleVerifierService } from './google-verifier.service';
import { DiscordOAuthService } from './discord-oauth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TasteepUser, TasteepSession, TasteepEmailOtp]),
    PassportModule,
    JwtModule.register({
      secret: tasteepConfig.jwtSecret,
      signOptions: { audience: TASTEEP_JWT_AUDIENCE },
    }),
    HttpModule,
    TasteepMailModule,
  ],
  providers: [
    TasteepAuthService,
    TasteepJwtStrategy,
    OtpService,
    GoogleVerifierService,
    DiscordOAuthService,
  ],
  controllers: [TasteepAuthController],
  exports: [TasteepAuthService],
})
export class TasteepAuthModule {}
