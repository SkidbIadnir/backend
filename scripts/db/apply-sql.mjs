#!/usr/bin/env node
/**
 * Applies a schema-change SQL file to the database named by POSTGRES_*, in one
 * transaction. Preprod and prod run with TypeORM `synchronize` off, so every
 * entity change ships with a file in scripts/db/ that this applies.
 *
 *   npm run db:apply -- scripts/db/002-tasteep-feedback.sql          # dry run: runs, then rolls back
 *   npm run db:apply -- scripts/db/002-tasteep-feedback.sql --yes    # commits
 *
 * POSTGRES_* come from the process environment first, then from `.env` if it
 * exists (it never overrides). Inside the container (Coolify → Terminal) there
 * is no `.env`, so the container's own variables are used:
 *
 *   node scripts/db/apply-sql.mjs scripts/db/NNN-x.sql [--yes]
 *
 * Use `--env <file>` to read another env file (it must exist). Files must be
 * idempotent (IF NOT EXISTS …) so re-running one is harmless.
 */
import { existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';

const args = process.argv.slice(2);
const commit = args.includes('--yes');
const envIdx = args.indexOf('--env');
const envFile = envIdx >= 0 ? args[envIdx + 1] : '.env';
const file = args.find(
  (a, i) => !a.startsWith('--') && (envIdx < 0 || i !== envIdx + 1),
);

if (!file) {
  console.error('usage: npm run db:apply -- <file.sql> [--yes] [--env <file>]');
  process.exit(2);
}

if (existsSync(envFile)) {
  dotenv.config({ path: envFile, quiet: true });
} else if (envIdx >= 0) {
  console.error(`env file not found: ${envFile}`);
  process.exit(2);
}
const {
  POSTGRES_HOST,
  POSTGRES_PORT,
  POSTGRES_DB,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
} = process.env;
if (!POSTGRES_HOST || !POSTGRES_DB || !POSTGRES_USER) {
  console.error(
    'POSTGRES_HOST, POSTGRES_DB and POSTGRES_USER must be set (environment or .env).',
  );
  process.exit(2);
}
const sql = readFileSync(file, 'utf8');
const target = `${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT ?? 5432}/${POSTGRES_DB}`;

const client = new pg.Client({
  host: POSTGRES_HOST,
  port: Number(POSTGRES_PORT ?? 5432),
  database: POSTGRES_DB,
  user: POSTGRES_USER,
  password: POSTGRES_PASSWORD,
});

console.log(`${commit ? 'Applying' : 'Dry run of'} ${file} on ${target}`);
try {
  await client.connect();
} catch (err) {
  console.error(`Could not connect to ${target}: ${err.message}`);
  process.exit(1);
}
const notices = [];
client.on('notice', (n) => notices.push(n.message));
try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query(commit ? 'COMMIT' : 'ROLLBACK');
  for (const n of notices) console.log(`  notice: ${n}`);
  console.log(
    commit ? 'Committed.' : 'OK, rolled back. Re-run with --yes to commit.',
  );
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`Failed, rolled back: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
