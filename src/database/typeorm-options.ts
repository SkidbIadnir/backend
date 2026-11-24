import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { MIGRATIONS } from './migrations';

/**
 * Connection settings shared by the app (`app.module.ts`) and the TypeORM
 * CLI (`data-source.ts`), so `migration:generate` diffs against exactly the
 * database the app would use. Reads `process.env` when called: load `.env`
 * (`import './env'`) before.
 *
 * The schema is only ever changed by migrations (`src/database/migrations/`),
 * never by `synchronize`; see `MIGRATIONS`.
 */
export function typeormOptions(): PostgresConnectionOptions {
  return {
    type: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'postgres',
    username: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    synchronize: false,
    migrations: MIGRATIONS,
    migrationsTableName: 'tasteep_migrations',
    // One transaction per migration: a failure rolls back only that one and
    // leaves the ones before it recorded as applied.
    migrationsTransactionMode: 'each',
  };
}
