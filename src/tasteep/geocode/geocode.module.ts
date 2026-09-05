import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { TasteepGeocodeCache } from '../entities/tasteep-geocode-cache.entity';
import { TasteepAuthModule } from '../auth/tasteep-auth.module';
import { GeocodeService, NOMINATIM_MIN_INTERVAL_MS } from './geocode.service';
import { GeocodeController } from './geocode.controller';
import { NominatimClient } from './nominatim.client';
import { SerialRateLimiter } from './rate-limiter';

@Module({
  imports: [
    TypeOrmModule.forFeature([TasteepGeocodeCache]),
    HttpModule,
    TasteepAuthModule,
  ],
  providers: [
    NominatimClient,
    {
      provide: SerialRateLimiter,
      useValue: new SerialRateLimiter(NOMINATIM_MIN_INTERVAL_MS),
    },
    GeocodeService,
  ],
  controllers: [GeocodeController],
})
export class GeocodeModule {}
