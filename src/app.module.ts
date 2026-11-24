import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { TasteepModule } from './tasteep/tasteep.module';
import { typeormOptions } from './database/typeorm-options';

/**
 * Root module:
 *
 *  - `TasteepModule`  → `src/tasteep/`  tables `tasteep_*`   routes `/auth/*`, `/tasteep/*`
 *  - `AdminModule`    → `src/admin/`    Tasteep's dashboard  routes `/admin/*`
 *
 * Entities are registered by each feature module (`autoLoadEntities`), so there
 * is no central entity list to keep in sync. The schema comes from the
 * migrations in `src/database/migrations/`, run at boot; `synchronize` is off
 * everywhere.
 *
 * `.env` is loaded in `src/env.ts`, imported first thing in `main.ts` — not
 * here. `TypeOrmModule.forRoot()` below reads `process.env` synchronously
 * while this file is being evaluated, so calling `dotenv.config()` down here
 * would be too late for it to see anything.
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...typeormOptions(),
      autoLoadEntities: true,
      // Pending migrations run before the app serves anything. A failing one
      // stops the boot, so a deploy never runs code against an old schema.
      migrationsRun: true,
      // SQL logging in dev only; the e2e suite sets NODE_ENV=test to keep its output readable.
      logging: !['production', 'test'].includes(process.env.NODE_ENV ?? ''),
    }),
    ScheduleModule.forRoot(),
    HealthModule,
    TasteepModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
