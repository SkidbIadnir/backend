import { Module } from '@nestjs/common';
import { TasteepAuthModule } from './auth/tasteep-auth.module';
import { TastingsModule } from './tastings/tastings.module';
import { GeocodeModule } from './geocode/geocode.module';
import { RegionsModule } from './regions/regions.module';
import { WishlistModule } from './wishlist/wishlist.module';
import { SmwsCodesModule } from './smws-codes/smws-codes.module';
import { SmwsBottlesModule } from './smws-bottles/smws-bottles.module';

/**
 * Tasteep — the spirit-tasting journal behind the Flutter app.
 *
 * Self-contained under `src/tasteep/`: tables `tasteep_*`, JWT audience
 * `tasteep`, routes `/auth/*` and `/tasteep/*`.
 */
@Module({
  imports: [
    TasteepAuthModule,
    RegionsModule,
    TastingsModule,
    GeocodeModule,
    WishlistModule,
    SmwsCodesModule,
    SmwsBottlesModule,
  ],
})
export class TasteepModule {}
