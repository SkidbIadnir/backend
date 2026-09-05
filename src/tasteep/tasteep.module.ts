import { Module } from '@nestjs/common';
import { TasteepAuthModule } from './auth/tasteep-auth.module';
import { TastingsModule } from './tastings/tastings.module';
import { GeocodeModule } from './geocode/geocode.module';

/**
 * Tasteep — the spirit-tasting journal behind the Flutter app.
 *
 * Self-contained under `src/tasteep/`: tables `tasteep_*`, JWT audience
 * `tasteep`, routes `/auth/*` and `/tasteep/*`. Shares nothing with SMWS.
 */
@Module({
  imports: [TasteepAuthModule, TastingsModule, GeocodeModule],
})
export class TasteepModule {}
