import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SmwsModule } from './smws/smws.module';
import { TasteepModule } from './tasteep/tasteep.module';

/**
 * Root module. Two fully independent projects share this process and this
 * Postgres database, but nothing else:
 *
 *  - `SmwsModule`     → `src/smws/`     tables `smws_*`                   routes `/smws/*`
 *  - `TasteepModule`  → `src/tasteep/`  tables `tasteep_*`                routes `/auth/*`, `/tasteep/*`
 *
 * Entities are registered by each feature module (`autoLoadEntities`), so there
 * is no central entity list to keep in sync.
 *
 * `.env` is loaded in `src/env.ts`, imported first thing in `main.ts` — not
 * here. `TasteepModule`'s static `JwtModule.register()` reads `process.env`
 * synchronously while this file's own imports are still being resolved, so
 * calling `dotenv.config()` down here is too late for it to see anything.
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'postgres',
      username: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.NODE_ENV !== 'production',
    }),
    ScheduleModule.forRoot(),
    SmwsModule,
    TasteepModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
