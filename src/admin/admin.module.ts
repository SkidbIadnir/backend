import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { SmwsArchive } from '../smws/entities/smws-archive.entity';
import { SmwsDistillery } from '../smws/entities/smws-distillery.entity';
import { SmwsLive } from '../smws/entities/smws-live.entity';
import { SmwsLookout } from '../smws/entities/smws-lookout.entity';
import { ScraperModule } from '../smws/scraper/scraper.module';
import { TasteepAuthModule } from '../tasteep/auth/tasteep-auth.module';
import { SmwsCodesModule } from '../tasteep/smws-codes/smws-codes.module';
import { GeocodeModule } from '../tasteep/geocode/geocode.module';
import { RegionsModule } from '../tasteep/regions/regions.module';
import { TasteepEmailOtp } from '../tasteep/entities/tasteep-email-otp.entity';
import { TasteepGeocodeCache } from '../tasteep/entities/tasteep-geocode-cache.entity';
import { TasteepSession } from '../tasteep/entities/tasteep-session.entity';
import { TasteepTasting } from '../tasteep/entities/tasteep-tasting.entity';
import { TasteepUser } from '../tasteep/entities/tasteep-user.entity';
import { adminConfig } from './admin-config';
import { AdminAuditService } from './admin-audit.service';
import { AdminGuard } from './admin-auth.guard';
import { AdminDistilleryLocationsController } from './admin-distillery-locations.controller';
import { AdminLogsController } from './admin-logs.controller';
import { AdminRegionsController } from './admin-regions.controller';
import { AdminSmwsController } from './admin-smws.controller';
import { AdminSmwsCodesController } from './admin-smws-codes.controller';
import { AdminSmwsService } from './admin-smws.service';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';
import { AdminTastingsController } from './admin-tastings.controller';
import { AdminTastingsService } from './admin-tastings.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { ADMIN_LOG_BUFFER, logBuffer } from './logging/log-buffer';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TasteepUser,
      TasteepSession,
      TasteepTasting,
      TasteepEmailOtp,
      TasteepGeocodeCache,
      SmwsLive,
      SmwsArchive,
      SmwsDistillery,
      SmwsLookout,
    ]),
    // Scoped to this module: only the admin controllers use ThrottlerGuard.
    ThrottlerModule.forRoot([
      { ttl: 60_000, limit: adminConfig.rateLimitPerMinute },
    ]),
    TasteepAuthModule,
    SmwsCodesModule,
    GeocodeModule,
    RegionsModule,
    ScraperModule,
  ],
  controllers: [
    AdminStatsController,
    AdminUsersController,
    AdminTastingsController,
    AdminSmwsController,
    AdminSmwsCodesController,
    AdminDistilleryLocationsController,
    AdminRegionsController,
    AdminLogsController,
  ],
  providers: [
    AdminGuard,
    AdminAuditService,
    AdminStatsService,
    AdminUsersService,
    AdminTastingsService,
    AdminSmwsService,
    { provide: ADMIN_LOG_BUFFER, useValue: logBuffer },
  ],
})
export class AdminModule {}
