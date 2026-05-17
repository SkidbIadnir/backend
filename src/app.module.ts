import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { config } from 'dotenv';
import { AppService } from './app.service';
import { DiscordModule } from './discord/discord.module';
import { WatchtowerModule } from './watchtower/watchtower.module';
import { PostgresModule } from './postgres/postgres.module';
import { ScraperModule } from './scraper/scraper.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmwsLive } from './entities/smws-live.entity';
import { SmwsArchive } from './entities/smws-archive.entity';
import { SmwsLookout } from './entities/smws-lookout.entity';
import { SmwsDistillery } from './entities/smws-distillery.entity';
import { UserAlert } from './entities/user-alert.entity';
import { User } from './users/user.entity';
import { AuthModule } from './auth/auth.module';

config();

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'postgres',
      username: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      entities: [SmwsLive, SmwsArchive, SmwsLookout, SmwsDistillery, UserAlert, User],
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.NODE_ENV !== 'production',
    }),
    DiscordModule,
    WatchtowerModule,
    PostgresModule,
    ScheduleModule.forRoot(),
    ScraperModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
