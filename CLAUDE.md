# Backend — Tasteep API

A NestJS 11 API (Express platform, TypeScript) for the Tasteep Flutter app (whisky tastings) and its admin panel.
It runs as one Nest process against one PostgreSQL database. `README.md` is the human overview, and
`docs/tasteep-api.md` is the client contract. Keep both in sync when you change endpoints.

## Commands

| Command | What it does |
|---|---|
| `npm run start:dev` | Runs `nest start --watch` |
| `npm run build` / `npm run start:prod` | `nest build` → `node dist/main` |
| `npm test` | Jest unit tests (`src/**/*.spec.ts`), no DB needed |
| `npm run test:e2e` | Jest e2e tests (`test/*.e2e-spec.ts`), serially (`--runInBand`), against the DB named by `POSTGRES_*` (shell first, then **`.env`**) |
| `npm run lint` | ESLint, **with `--fix`** (it rewrites files) |
| `npm run lint:check` | ESLint + `prettier --check`, no writes. CI runs this. |
| `npm run format` | Prettier on `src/` and `test/` |
| `npm run migration:generate -- src/database/migrations/<Name>` | Builds, then writes a migration with the SQL that takes the DB named by `POSTGRES_*` to the entities. Point it at a DB that is up to date with the existing migrations. |
| `npm run migration:check` | Fails (and prints the SQL) if the entities differ from the DB's schema. Needs a build. CI runs it after `migration:run`. |
| `npm run migration:show` / `migration:run` / `migration:revert` | Lists applied/pending migrations, runs pending ones, reverts the last one. Need a build. |
| `npm run db:apply -- <file.sql> [--yes] [--env <file>]` | Applies an ad hoc SQL file to the DB named by `POSTGRES_*` (process env first, then `.env` if present). It does a dry run (transaction + rollback) unless you pass `--yes`. Schema changes go through migrations, not this. |
| `TASTEEP_TOKEN=<jwt> npm run test:postman` | Runs the Newman scenario in `postman/` against a running server |

- Use Node 20, the same version as the Docker image and CI. `package.json` has no `engines` field.
  Node 20 reached end of life in April 2026; moving to Node 22 or 24 LTS is a separate follow-up.
- Prettier config is `singleQuote` + `trailingComma: all`.
- ESLint uses `typescript-eslint` `recommendedTypeChecked`. `no-explicit-any` is off.
- There is no husky or lint-staged, so run `lint:check` and tests yourself before you commit.
- ESLint relaxes the `no-unsafe-*`, `require-await` and `unbound-method` rules in `*.spec.ts` and `test/`
  (jest mocks), see `eslint.config.mjs`.

## Architecture

- `src/main.ts`:
  - `import './env'` (which runs dotenv) **must stay the first line**, because `TypeOrmModule.forRoot()` in
    `app.module.ts` reads `process.env` at import time. The e2e specs also start with `import '../src/env'`.
    dotenv never overrides variables already in the environment, and a missing `.env` is fine (containers).
  - It sets a global `ValidationPipe({ whitelist: true })`, with no `transform`.
  - CORS origins come from `FRONTEND_URL` (comma-separated).
  - It listens on `PORT` (default 3000).
- `AppModule` imports TypeORM, `ScheduleModule`, `TasteepModule` and `AdminModule`.
- There is no global route prefix. Each controller declares its full path.
- `src/health/`: unauthenticated `GET /health` runs `SELECT 1` (3 s timeout) and returns `200 {"status":"ok"}`
  or `503`. The Docker `HEALTHCHECK` and the CI post-deploy smoke test use it.

### `src/tasteep/`: user-facing API (`/auth/*`, `/tasteep/*`)

- Each feature folder (`auth`, `tastings`, `wishlist`, `geocode`, `regions`, `flavours`, `smws-codes`,
  `smws-bottles`, `photos`, `feedback`, `mail`) normally holds `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`,
  `*.mapper.ts` and colocated `*.spec.ts`.
- All entities live in `src/tasteep/entities/`.
- Seed JSON lives in `src/tasteep/data/` and is loaded in `onModuleInit` of the regions, flavours,
  smws-codes and distillery-locations services.
- Put pure logic in plain files (`*.parse.ts`, `*.rules.ts`, `*.search.ts`, `*.mapper.ts`) so it can be
  unit-tested without Nest.
- The JSON contract is **snake_case**, for both request DTO fields and mapper output. Entities use camelCase
  properties mapped to snake_case columns.

### `src/admin/`: admin API (`/admin/*`)

- An admin is a normal Tasteep user whose email is in `ADMIN_EMAILS`. There is no role column and no separate
  login.
- Protect controllers with `@AdminProtected()`:
  - It applies `ThrottlerGuard` first, then `AdminGuard`.
  - `AdminGuard` extends the Tasteep JWT guard and adds the email allowlist and the `ADMIN_SESSION_MAX_HOURS`
    session-age check.
  - It sets `req.admin = { userId, sessionId, email }`.
- Use `@AdminQuery()` for query DTOs. It validates *with* `transform`, which the global pipe does not do.
- Call `AdminAuditService.record(email, action, target)` on every mutation.
- Swagger JSON is generated for `AdminModule` only and served at `/admin/openapi.json`.
- `AdminLogger` copies Nest logs into an in-memory ring of 2000 entries. `GET /admin/logs` serves it, and it
  is lost on restart.

### Auth (`src/tasteep/auth/`)

- Login methods:
  - Email OTP (HMAC'd 6-digit code)
  - Google ID token (`google-auth-library`)
  - Discord code exchange
- A verified email that already exists signs into that account, whatever the provider.
- Every login inserts a `tasteep_sessions` row and returns a JWT:
  - The payload is `{ sub: userId, sid: sessionId }`, with `audience: 'tasteep'`.
  - It lasts 365 days by default.
- `TasteepJwtStrategy` (passport-jwt) checks the session row **on every request**, so revocation and
  sign-out take effect immediately.
- User routes use `@UseGuards(TasteepJwtAuthGuard)` and read `req.user.sub` (`TasteepAuthRequest`).
- **Every query must be scoped to that user id.**
- `GET /tasteep/photos/:photoId/:size` is the one unauthenticated data route. It uses HMAC-signed,
  day-bucketed URLs (`photo-url.ts`).

### Errors, validation, logging

- Validation uses `class-validator` / `class-transformer` DTOs, plus `ParseUUIDPipe` on `:id` params.
  The project does not use zod.
- Throw Nest's built-in exceptions (`BadRequestException`, `NotFoundException`,
  `HttpException(…, TOO_MANY_REQUESTS)`, …). There is no custom exception filter or interceptor.
- Log with `new Logger(ClassName.name)` per service.

### External integrations

- **Nominatim geocoding:**
  - `SerialRateLimiter` keeps it to 1 request per second server-wide, and identical in-flight queries share
    one call.
  - Every result, misses included, is cached forever in `tasteep_geocode_cache`.
  - It returns 503 until `TASTEEP_NOMINATIM_USER_AGENT` is set.
- **SMTP via nodemailer:** if `TASTEEP_SMTP_HOST` is unset, the OTP is logged instead of emailed.
- **smws.eu scraper** (`smws-bottles/`):
  - It fetches pages over HTTP and parses them with cheerio.
  - It runs nightly via `@Cron` (`tasteep-smws-scrape`), or manually through `POST /admin/smws/scraper/run`.
  - A Postgres advisory lock (`pg_advisory_lock`) stops two runs overlapping, and each run is logged in
    `tasteep_smws_scrape_runs`.
  - Bumping `CATALOG_RULES_VERSION` in `smws-catalog.rules.ts` makes the next run re-read every bottle,
    which takes about 2 hours.
  - Set `TASTEEP_SMWS_SCRAPER_ENABLED=false` to turn the cron off.
- **Photos:**
  - Uploads go through multer `FileInterceptor('photo')`, with a 20 MB cap (413 above it).
  - `sharp` re-encodes them to WebP (max 2048 px, plus a 480 px thumbnail) and strips metadata.
  - Files are stored on local disk under `TASTEEP_PHOTOS_DIR` (`/data/photos` in Docker, a persistent
    Coolify volume per environment). They are not in Postgres, so back the volume up with the DB dump.
  - To move to S3, swap `photo-storage.service.ts`.

## Database (TypeORM 0.3 + `pg`)

- Connection options live in `src/database/typeorm-options.ts` (`POSTGRES_*` env vars), shared by
  `TypeOrmModule.forRoot` in `src/app.module.ts` and the CLI data source `src/database/data-source.ts`:
  - `autoLoadEntities: true` in the app means each feature module registers its entities with
    `TypeOrmModule.forFeature([...])`. There is no central entity list; the CLI finds them by file name
    (`*.entity.js` under `dist/`).
  - `synchronize` is **off everywhere** (local, dev, e2e, preprod, prod).
  - SQL logging is on unless `NODE_ENV` is `production` or `test`.
- **Migrations** (`src/database/migrations/`) are the only way the schema changes:
  - The app runs pending ones at boot (`migrationsRun`), one transaction each, before serving. A failing
    migration stops the boot. Applied ones are recorded in `tasteep_migrations`.
  - So starting the app or the e2e suite **migrates whatever DB `POSTGRES_*` / `.env` point at**. Check
    `.env` first and never casually point it at a database you care about.
  - To change the schema: change the entity, `npm run migration:generate -- src/database/migrations/<Name>`
    against a DB that has every existing migration, review the SQL, run `npm run format`, then import the class
    in `src/database/migrations/index.ts` and append it (they are listed by hand, not globbed).
  - CI fails when an entity changed without a migration (`migration:check`).
  - A deploy starts the new container while the old one still serves, so migrations must not break the
    previous release: add first, drop or rename in a later release.
  - `1795529563637-Baseline.ts` creates the whole schema on an empty DB, and on an existing one only catches
    up on what the old `scripts/db/001`/`002` files did. It cannot be reverted.
  - `scripts/db/*.sql` are the pre-migration history; don't add new ones for schema changes.
- Naming:
  - Tables are `tasteep_<plural>`.
  - Columns are snake_case via `@Column({ name: 'snake_case' })`.
  - Index names are explicit: `tasteep_<table>_<cols>_idx` / `_uq`.
  - Ids are `@PrimaryGeneratedColumn('uuid')`.
  - Timestamps are `timestamptz` (`@CreateDateColumn` / `@UpdateDateColumn`).
  - User-owned rows use `@ManyToOne(() => TasteepUser, { onDelete: 'CASCADE' })` + `@JoinColumn({ name: 'user_id' })`
    plus an explicit `userId` column.
- Entities and their tables:
  - `TasteepUser` (`tasteep_users`)
  - `TasteepSession`
  - `TasteepEmailOtp`
  - `TasteepTasting`, which links to a region and an SMWS bottle (both `SET NULL`). `tags` is free text;
    `flavour_ids` is derived from it by `FlavoursService` (on write, and `reindex` after vocabulary changes).
  - `TasteepGeocodeCache`
  - `TasteepRegion` (self-referencing tree)
  - `TasteepFlavour` (`tasteep_flavours`, category → flavour tree with en/fr names and aliases)
  - `TasteepSmwsCode`
  - `TasteepSmwsBottle` → **`tasteep_smws_catalog`**
  - `TasteepSmwsPage`
  - `TasteepSmwsScrapeRun`
  - `TasteepDistilleryLocation`
  - `TasteepWishlistFolder` / `TasteepWishlistItem`
  - `TasteepFeedback`
- Raw SQL is rare. It goes through `repo.query` / `queryRunner.query` (regions reorder, scraper advisory
  lock, migrations). `pg` is used directly only in `scripts/db/apply-sql.mjs`.

## Configuration

- Read env vars through the lazy getters in `src/tasteep/tasteep-config.ts` (`tasteepConfig`) and
  `src/admin/admin-config.ts` (`adminConfig`). Don't read `process.env` ad hoc.
- When you add a variable, add a getter there and document it in `.env.example`.
- Never print or commit `.env` values.
- Key groups:
  - `POSTGRES_*`, `PORT`, `NODE_ENV`, `FRONTEND_URL`, `APP_URL`
  - `TASTEEP_JWT_*`. The secret goes through `tasteepConfig.jwtSecret` (canonical `TASTEEP_JWT_SECRET`, falls
    back to legacy `JWT_SECRET` when unset or empty, throws at startup when neither is set). JWT signing,
    `TasteepJwtStrategy`, OTP hashing and the photo-URL key all read it there.
  - `TASTEEP_SMTP_*`: once `TASTEEP_SMTP_HOST` is set, `_USER` and `_PASS` are required (startup fails).
  - `TASTEEP_OTP_*`
  - `TASTEEP_GOOGLE_CLIENT_IDS`, `TASTEEP_DISCORD_*`
  - `TASTEEP_NOMINATIM_*`, `TASTEEP_SMWS_*`
  - `TASTEEP_PHOTOS_DIR`, `TASTEEP_PHOTO_URL_SECRET`, `TASTEEP_FEEDBACK_MAX_PER_HOUR`
  - `ADMIN_EMAILS`, `ADMIN_SESSION_MAX_HOURS`, `ADMIN_RATE_LIMIT_PER_MINUTE`

## Testing

- **Unit tests** (`npm test`):
  - Jest 30 + ts-jest. Config is inline in `package.json`, with `rootDir: src`.
  - Specs sit next to the code.
  - Mock repositories with `createMockRepository` / `createMockQueryBuilder` from
    `src/test-utils/mock-repository.factory.ts`.
  - Fixtures are in `src/tasteep/test-utils/`.
- **E2E tests** (`npm run test:e2e`, config `test/jest-e2e.json`):
  - They boot the real `AppModule` with supertest against the real Postgres, real guards and real validation.
  - Only Nominatim is stubbed.
  - `NODE_ENV` defaults to `test`.
  - Each suite creates throw-away users tagged with a run suffix and must delete them in `afterAll`, and
    must `app.close()` there, or Jest never exits (CI would hang until the job timeout).
  - CI runs them on every pull request against an empty `postgres:18` service. Locally, prefer a throw-away
    container over `.env` (README "End-to-end tests" has the command).

## Adding a user-facing feature (pattern: `src/tasteep/feedback/`)

1. Add the entity in `src/tasteep/entities/tasteep-<x>.entity.ts`, following the naming rules above.
2. Add `dto/*.dto.ts` with class-validator decorators and snake_case fields.
3. Add the service: `@InjectRepository`, every query scoped by `userId`, Nest exceptions, and snake_case
   output via a mapper.
4. Add the controller: `@Controller('tasteep/<x>')`, `@UseGuards(TasteepJwtAuthGuard)`, and `req.user.sub`.
5. Add the module: `TypeOrmModule.forFeature([Entity])` + `TasteepAuthModule`. Register it in
   `src/tasteep/tasteep.module.ts`.
6. Generate its migration (`npm run migration:generate`) and register it in `src/database/migrations/index.ts`.
7. Add unit specs, plus a `test/tasteep-<x>.e2e-spec.ts` if the feature touches the DB.
8. Update `docs/tasteep-api.md`, the README endpoint table, and `postman/` if relevant.

For an admin feature: add `src/admin/admin-<x>.controller.ts` with `@ApiTags('admin')` + `@AdminProtected()`,
register it in `src/admin/admin.module.ts` (plus `forFeature` for the entities it needs), and audit every
mutation.

## Build & deploy

### Environments

One server (Hostinger, Coolify v4.7, Traefik with one Let's Encrypt certificate per subdomain). Coolify's
dashboard and API are reachable **only on the Tailscale tailnet**, so GitHub cannot call Coolify webhooks.
Coolify project `tasteep`, one environment per deployment branch, each with its **own** Postgres 18 resource
and its **own** secrets (never share a JWT or photo-URL secret between environments):

| Branch | Environment | API | Web app | Admin |
|---|---|---|---|---|
| `dev` | dev | `api.dev.tasteep.eu` | `app.dev.tasteep.eu` | `admin.dev.tasteep.eu` |
| `preprod` | preprod | `api.preprod.tasteep.eu` | `app.preprod.tasteep.eu` | `admin.preprod.tasteep.eu` |
| `prod` | production | `api.tasteep.eu` | `app.tasteep.eu` | `admin.tasteep.eu` |

`api.skidhub.fr`, the old VPS, `:latest` and watchtower are retired. Nothing should point to them.

Runtime variables live in Coolify (tick "Available at runtime"; turn on "Is Literal" for values containing
`$`), not in GitHub:

| Variable | dev | preprod | prod |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` | `production` |
| `FRONTEND_URL` | `https://app.dev.tasteep.eu` (+ admin origin) | `https://app.preprod.tasteep.eu` (+ admin) | `https://app.tasteep.eu` (+ admin) |
| `APP_URL` | `https://api.dev.tasteep.eu` | `https://api.preprod.tasteep.eu` | `https://api.tasteep.eu` |
| `TASTEEP_JWT_SECRET`, `TASTEEP_PHOTO_URL_SECRET` | unique | unique | unique |
| `TASTEEP_SMTP_*` | unset (OTPs logged) | set | set |
| `TASTEEP_SMWS_SCRAPER_ENABLED` | `false` | `false` | `true` |

All three also set `PORT=3000`, `POSTGRES_*` (their own DB, internal Coolify host),
`TASTEEP_NOMINATIM_USER_AGENT` and the `ADMIN_*` variables, and have a persistent volume on `/data/photos`.
`FRONTEND_URL` must hold exact origins (https, no trailing slash), or the CORS preflight fails (it showed up
as a `404` on `OPTIONS /auth/email`).

### Image

- `Dockerfile` has two stages:
  - build (`node:20-bookworm`): `npm ci`, `npm run build`, `npm prune --omit=dev`;
  - runtime (`node:20-bookworm-slim`, glibc for `sharp`): `dist/`, production `node_modules`, `package.json`
    and `scripts/db/`.
- It sets `NODE_ENV=production` and `TASTEEP_PHOTOS_DIR=/data/photos`, exposes 3000, and has a `HEALTHCHECK`
  on `/health` (through `node -e fetch`, since the slim image has no curl).
- It still runs as root, because the existing Coolify photo volumes are owned by root. Switching to the
  `node` user needs a one-off `chown -R 1000:1000` of each volume.
- `.dockerignore` keeps `.env`, `.git`, `node_modules`, docs and Postman out of the build context.

### Pipeline (`.github/workflows/ci-cd.yml`)

- **Pull request** into `dev` / `preprod` / `prod`: job `checks` (`npm ci`, `lint:check`, `build`, `npm test`),
  then job `e2e` against a `postgres:18` service. Nothing is deployed. e2e must pass before code reaches
  preprod or prod.
- **Push** to `dev` / `preprod` / `prod`, or `workflow_dispatch` on one of them: `checks`, then:
  1. `image`: tags `ghcr.io/skidbiadnir/backend:tree-<git rev-parse HEAD^{tree}>`. If that tag already exists
     the build is skipped, so a promotion PR with no other change runs **exactly the image tested on dev**.
     Then `docker buildx imagetools create` moves the branch tag (`:dev`, `:preprod`, `:prod`) to it.
  2. `deploy`: joins the tailnet (`tailscale/github-action@v4`, ephemeral node `tag:ci`), then calls
     `POST $COOLIFY_URL/api/v1/deploy?uuid=<resource>` (v4.7 refuses GET), polls
     `GET /api/v1/deployments/<deployment_uuid>` until `finished` (fails on `failed` / `cancelled-by-user`,
     or after 15 min), and smoke-tests `GET /health` on the public URL.
- `paths-ignore`: `**/*.md`, `docs/**`, `postman/**`. A docs-only push deploys nothing, but it changes the
  tree hash, so the next promotion rebuilds instead of reusing the dev image.
- Each Coolify backend is a **Docker Image** resource on `ghcr.io/skidbiadnir/backend:<branch>`. GHCR images
  are private; the server pulls with a root `docker login ghcr.io` (classic token, `read:packages` only).
- Repository secrets: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `COOLIFY_URL`
  (`http://<server-tailscale-ip>:8000`), `COOLIFY_TOKEN`, `COOLIFY_UUID_DEV` / `_PREPROD` / `_PROD`. Never print
  them in the workflow.

### Schema changes on preprod and prod

Nothing to do by hand: each environment runs its pending migrations when the new container boots. A promotion
PR carries the same migrations that already ran on dev (and preprod).

- Before promoting a release with a migration that rewrites or drops data, take a `pg_dump` of that environment.
- To inspect an environment: Coolify → its backend → **Terminal** (the container's own `POSTGRES_*`, no `.env`),
  then `npm run migration:show`, or `npm run migration:check` to compare its schema with the entities.

# Git conventions

## Branches

- `dev`, `preprod` and `prod` are deployment branches. Each one deploys its environment when it changes:
  `dev` → api.dev.tasteep.eu, `preprod` → api.preprod.tasteep.eu, `prod` → api.tasteep.eu.
- Work branches start from `dev` and merge back into it via PR (squash allowed).
- Promotion is by PR only, with a merge commit (no squash): `dev` → `preprod` → `prod`.
- `master` is not deployed. It is updated only for major versions: merge `prod` into `master` and tag `vX.0.0`.
- Never commit directly to `dev`, `preprod`, `prod` or `master`.
- `hotfix/` branches start from `prod`, merge into `prod`, then `prod` is merged back into `preprod` and `dev`.
- Work branches are named `type/short-description`:
  - lowercase kebab-case, 2–5 words, describing the change (no names, dates or `wip`)
  - optional GitHub issue number after the prefix: `feat/42-wishlist-sharing`
- Allowed types:

| Prefix      | Use for                                   |
|-------------|-------------------------------------------|
| `feat/`     | new functionality                         |
| `fix/`      | bug fixes                                 |
| `chore/`    | dependencies, config, housekeeping        |
| `refactor/` | restructuring with no behavior change     |
| `docs/`     | documentation only                        |
| `test/`     | adding or fixing tests                    |
| `ci/`       | pipelines and workflows                   |
| `perf/`     | performance work                          |
| `hotfix/`   | urgent fix branched from `prod`, merged into `prod`, then `prod` is merged back into `preprod` and `dev` |
| `release/`  | release preparation (`release/1.2.0`)     |

- Delete branches once merged.

## Commits

Follow Conventional Commits, with the same types as branches:
`type(optional-scope): imperative summary`, e.g. `feat(tasteep): add wishlist sharing`,
`fix: handle empty geocode response`, `chore(deps): fix npm audit vulnerabilities`.
Reference issues with `Closes #42` in the PR description when relevant.
