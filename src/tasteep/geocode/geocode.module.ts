import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { TasteepGeocodeCache } from '../entities/tasteep-geocode-cache.entity';
import { TasteepDistilleryLocation } from '../entities/tasteep-distillery-location.entity';
import { TasteepAuthModule } from '../auth/tasteep-auth.module';
import { GeocodeService, NOMINATIM_MIN_INTERVAL_MS } from './geocode.service';
import { GeocodeController } from './geocode.controller';
import { NominatimClient } from './nominatim.client';
import { SerialRateLimiter } from './rate-limiter';
import { DistilleryLocationsService } from './distillery-locations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TasteepGeocodeCache, TasteepDistilleryLocation]),
    HttpModule,
    TasteepAuthModule,
  ],
  providers: [
    NominatimClient,
    DistilleryLocationsService,
    {
      provide: SerialRateLimiter,
      useValue: new SerialRateLimiter(NOMINATIM_MIN_INTERVAL_MS),
    },
    GeocodeService,
  ],
  controllers: [GeocodeController],
})
export class GeocodeModule {}
