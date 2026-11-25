# Backend — Tasteep

One NestJS process, one PostgreSQL database:

| Module | Folder | Tables | Routes | Auth |
|---|---|---|---|---|
| **Tasteep** — spirit-tasting journal behind the Flutter app, including the SMWS bottles scraped from smws.eu | `src/tasteep/` | `tasteep_*` | `/auth/*`, `/tasteep/*` | JWT, audience `tasteep` |
| **Admin** — dashboard API over Tasteep | `src/admin/` | (Tasteep's) | `/admin/*` | Tasteep JWT + `ADMIN_EMAILS` allowlist |

## Repository layout

```
src/
├── app.module.ts            TypeORM root (autoLoadEntities) + the two project modules
├── main.ts                  CORS, global ValidationPipe (whitelist)
├── health/                  GET /health — liveness + `SELECT 1`, for Docker, CI and uptime checks
├── test-utils/              generic jest mocks (repository / query-builder)
│
├── tasteep/
│   ├── tasteep.module.ts
│   ├── tasteep-config.ts    every TASTEEP_* env var in one place
│   ├── entities/            tasteep_users, tasteep_sessions, tasteep_email_otps,
│   │                        tasteep_tastings, tasteep_geocode_cache, tasteep_regions,
│   │                        tasteep_flavours
│   ├── auth/                /auth/* — email OTP, Google ID token, Discord code, sessions
│   │   ├── tasteep-auth.controller.ts / .service.ts / .module.ts
│   │   ├── otp.service.ts               issue/verify 6-digit codes (HMAC, TTL, attempts, cooldown)
│   │   ├── google-verifier.service.ts   google-auth-library ID-token check
│   │   ├── discord-oauth.service.ts     authorize URL + server-side code exchange
│   │   ├── tasteep-jwt.strategy.ts      validates the JWT *and* the session row
│   │   ├── tasteep-jwt-auth.guard.ts
│   │   ├── auth-user.ts                 AuthUser JSON mapper
│   │   └── dto/
│   ├── mail/                nodemailer SMTP transport (logs the code when SMTP is unset)
│   ├── tastings/            /tasteep/tastings, /tasteep/stats, /tasteep/smws/me, prefill from an SMWS bottle
│   │   ├── tastings.controller.ts / .service.ts / .module.ts
│   │   ├── tasting.mapper.ts            entity ⇄ snake_case JSON contract
│   │   └── dto/
│   ├── geocode/             /tasteep/geocode — cache-first Nominatim with a 1 req/s limiter
│   ├── regions/             /tasteep/regions — curated country/subregion picker, seeded from data/region.json
│   ├── flavours/            /tasteep/flavours — flavour vocabulary that tags match, seeded from data/flavours.json
│   ├── smws-codes/          /tasteep/smws-codes — SMWS code → distillery list, seeded from data/smws-codes.json
│   ├── smws-bottles/        /tasteep/smws-bottles — bottles read from smws.eu (see below)
│   │   ├── smws-http.client.ts          plain HTTP to smws.eu: sitemap + product pages, 3 s apart
│   │   ├── smws-product.parser.ts       pure: product page HTML → raw fields (cheerio)
│   │   ├── smws-catalog.rules.ts        pure: raw fields → bottle, merge that never loses a value
│   │   ├── smws-bottle-sync.service.ts  one run: lock, discover, stock check, relist sweep
│   │   ├── smws-bottle.search.ts        pure: list/search query → validated filters
│   │   ├── smws-bottles.service.ts      list, search, facets for the app; admin status
│   │   └── smws-scrape.scheduler.ts     nightly cron
│   ├── wishlist/            /tasteep/wishlist — folders and items
│   ├── feedback/            /tasteep/feedback — user feedback (bug / idea / other), rate-limited per user
│   └── test-utils/          Tasteep fixtures
│
└── admin/                   /admin/* dashboard API (stats, users, tastings, SMWS, codes, regions, flavours, feedback, logs)

docs/
└── tasteep-api.md           full client contract for the Flutter app
```

## Tasteep

### Auth

Three ways to obtain a bearer token, all returning the same `AuthUser` JSON
(`{id, display_name, provider, email, token}`):

| Provider | Flow |
|---|---|
| Email | `POST /auth/email {email}` sends a 6-digit code (10 min TTL, 5 attempts, 60 s resend cooldown). `POST /auth/email/verify {email, code}` returns the `AuthUser`. |
| Google | Client does `google_sign_in`, posts the ID token to `POST /auth/google {id_token}`. Verified against `TASTEEP_GOOGLE_CLIENT_IDS`. |
| Discord | Client opens `GET /auth/discord`, catches the `code` on its `tasteep://` redirect, posts `POST /auth/discord {code, redirect_uri}`. The client secret stays on the server. |

Accounts are keyed on `(provider, provider_id)`. A verified email that already belongs to an
account signs into that account regardless of provider, so one person does not end up with
two journals.

**Sessions.** Every login inserts a `tasteep_sessions` row and issues a long-lived JWT
(`TASTEEP_JWT_EXPIRES_IN`, default 365 d) carrying `sub` (user) and `sid` (session). The
guard loads the session on every request, so `POST /auth/signout` revokes a token for real.
`GET /auth/me` restores the session on app start.

### Data

`tasteep_tastings` follows the handoff schema one-to-one (snake_case columns, `text[]` tags,
check constraints on `category`, `location_precision`, `score`, indexes on
`(user_id, date_tasted)` and `(user_id, category)`). Two deliberate deviations:

- `photo_path` is kept next to the uploaded photo: it holds whatever opaque device path the
  client sends and echoes it back, so the app can show the local file offline. The uploaded
  photo is `photo_id` (server-generated), exposed as signed `photo_url`/`photo_thumb_url`.
- `tasteep_geocode_cache.lat/lon` are nullable: misses are cached as `unknown` so a place
  Nominatim cannot resolve is never asked for again.
- `tags` stay free text, as typed. `flavour_ids` is derived from them: the ids of
  `tasteep_flavours` they match (by id, English/French name or alias, ignoring case and
  accents). It is set on every write and recomputed for all tastings whenever the vocabulary
  changes (boot seed, admin edits), so it is what stats and filters should read.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | No token. `200 {"status":"ok"}`, or `503` when the database does not answer |
| `POST` | `/auth/email` | Send login code |
| `POST` | `/auth/email/verify` | Exchange code for `AuthUser` |
| `POST` | `/auth/google` | Google ID-token login |
| `GET` | `/auth/discord` | Redirect to Discord consent page |
| `POST` | `/auth/discord` | Discord code login |
| `GET` | `/auth/me` | Current user (validates stored token) |
| `POST` | `/auth/signout` | Revoke this session |
| `GET` | `/tasteep/tastings[?unplaced=true]` | List (newest `date_tasted` first) |
| `GET` | `/tasteep/tastings/:id` | One tasting |
| `PUT` | `/tasteep/tastings/:id` | Upsert, full replacement, client-generated UUID |
| `DELETE` | `/tasteep/tastings/:id` | Delete |
| `PUT` | `/tasteep/tastings/:id/location` | Manual pin / geocode result / clear |
| `PUT` | `/tasteep/tastings/:id/photo` | Upload / replace the photo (multipart `photo`) |
| `DELETE` | `/tasteep/tastings/:id/photo` | Remove the photo |
| `GET` | `/tasteep/photos/:photoId/:size` | Signed photo URL (no token), `full` or `thumb` |
| `GET` | `/tasteep/stats` | `{count, avg_score, distinct_distilleries}` |
| `POST` | `/tasteep/geocode` | `{query}` → `{lat, lon, precision}` |
| `GET` | `/tasteep/regions` | Country → subregion tree with centroids, ETag/304 |
| `GET` | `/tasteep/flavours` | Category → flavour tree (English/French labels) that tags are matched against, ETag/304 |
| `POST` | `/tasteep/feedback` | `{type, message, app_version?, platform?}` → `{id, created_at}`; 429 over the hourly limit |

Request/response details, status codes and the location-precision rules are in
[docs/tasteep-api.md](./docs/tasteep-api.md).

### Rules enforced server-side

- Everything under `/tasteep/*` is scoped to the user in the token; there is no cross-user read.
- A `manual` location pin is never overwritten by an automated geocode, whether it arrives via
  the location endpoint (`409`) or inside a full `PUT` (the stored pin is kept).
- Nominatim is called at most once per second for the whole server, always with the
  identifying `TASTEEP_NOMINATIM_USER_AGENT`, and every result (including "not found") is
  cached forever. Identical concurrent queries share one upstream request.
- Uploaded photos are re-encoded by `sharp` (WebP, ≤ 2048 px and a 480 px thumbnail) with all
  metadata stripped — phone photos carry GPS coordinates. Anything sharp cannot decode as
  JPEG/PNG/WebP/AVIF is a `400`; uploads are capped at 20 MB (`413`).

### Tasting photos

Files live on local disk under `TASTEEP_PHOTOS_DIR` (`<dir>/<2 hex>/<photo_id>.webp` and
`.thumb.webp`). Only `src/tasteep/photos/photo-storage.service.ts` knows that, so moving to
S3-compatible storage later means replacing that one class.

Photos are served without the bearer token, through an HMAC-signed URL, so Flutter's
`Image.network` works on Android and on the web build alike. The expiry is snapped to a UTC day
boundary: URLs are identical all day (HTTP caches keep hitting) and valid 24–48 h. A new upload
gets a new `photo_id`, so a cached old photo is never shown for it. Deleting a photo or its
tasting deletes the files.

### SMWS bottles

Every night at midnight (`TASTEEP_SMWS_SCRAPER_ENABLED=false` turns the cron off) the scraper
reads smws.eu over **plain HTTP, no browser**, one request every 3 s
(`TASTEEP_SMWS_REQUEST_INTERVAL_MS`), and keeps `tasteep_smws_catalog` up to date. It only
uses public pages: the product sitemap (`/xmlsitemap.php`) and the product pages.

1. **Discovery:** every sitemap URL never read before is read once and recorded in
   `tasteep_smws_pages` (`bottle`, `other` for products without an ABV, `gone` for 404). The
   first run reads the whole sitemap (~2,500 pages, about 2 hours); it saves page by page, so
   an interrupted run resumes where it stopped.
2. **Stock check:** every in-stock bottle's page is re-read. **Availability is the page's own
   stock flag** (`BCData.product_attributes.instock`): out of stock (or a 404) sets
   `in_stock = false` and `delisted_at`; back in stock clears them.
3. **Relist sweep:** sold-out bottles are re-read weekly while their page is still in the
   sitemap (a listed page can be restocked, months later or for an event), or for 30 days after
   selling out when it is not. At most 500 per run, recently sold-out ones first; a backlog
   (such as the first runs after this rule shipped) clears over a few nights.
4. Pages read as `other` are re-read monthly.
5. **Rules upgrades:** bottle pages read under an older `CATALOG_RULES_VERSION`
   (`smws-catalog.rules.ts`) are read again, so a parsing fix reaches the whole archive. Bump
   the version with any rules change that should apply to stored bottles; the next run then
   re-reads every bottle page once (about 2 hours).

Bottles are keyed by the shop's **SKU**, in three kinds:

- `single_cask`: one SMWS cask code (`code = 1.309`). When a page shows no code, it is decoded
  from the SKU (`005138EU…` → `5.138`).
- `blend`: whisky without a single cask code. `batch` holds the label it is sold under
  (`Batch 40`, `Distillery 68 Rare Release`, `BAT.14`), including `SM` codes (`SM0.001`).
- `other`: everything else with an ABV, such as tasting packs, gift sets, two-cask duos, gin,
  rum and beer.

The shop stores some titles double-encoded (`PÃ¢tisserie`); text fields are repaired on read.
An ABV given as a fraction (`0.556%`) is read as 55.6%, and a €0.00 price is stored as no
price. Each field is read from the visible info list first (same format as before),
then from the shop's `custom_fields`; profile comes from the product's categories, price and
stock from the shop's JSON. A read that lacks a field never erases a stored value, and
categories accumulate. Bottles are never deleted: sold-out rows are our archive. Each single
cask links to its distillery through `tasteep_smws_codes` and to a curated region or subregion.

One run at a time across processes (Postgres advisory lock); a failed read changes nothing and
is retried next run; every run is logged in `tasteep_smws_scrape_runs` (shown by
`GET /admin/smws/status`).

`GET /tasteep/smws-bottles` serves the list to the app (see `docs/tasteep-api.md`);
`POST /admin/smws/scraper/run` starts a run by hand.

## Setup

```bash
npm install
cp .env.example .env   # fill in — every variable is documented in the file
npm run start:dev
```

Requirements: Node 20 (same as the Docker image and CI), PostgreSQL 14+ (the servers run 18).
### Database schema (migrations)

The schema is managed by TypeORM migrations in `src/database/migrations/`. The app runs the
pending ones on boot, before it serves anything, in every environment; `synchronize` is off
everywhere. `tasteep_migrations` records what each database has received.

To change the schema:

```bash
# 1. edit the entity, then, against a database that has all existing migrations:
npm run migration:generate -- src/database/migrations/AddWishlistSharing
# 2. read the generated SQL, then:
npm run format
# 3. import the new class in src/database/migrations/index.ts and append it to MIGRATIONS
```

`npm run migration:show` lists applied and pending migrations, `migration:check` fails if the
entities and the database differ (CI runs it on every pull request), `migration:revert` undoes
the last one. All of them work on `dist/`, so build first (`migration:generate` does).

A deploy starts the new container while the old one still serves requests, so a migration must
not break the previous release: add columns and tables first, drop or rename them a release later.

The first migration, `Baseline`, creates the whole schema on an empty database. On an existing one
(dev, preprod and prod, built by `synchronize` and the old hand-written SQL), it creates nothing it
already has and only catches up on `scripts/db/001`/`002`. Those SQL files are kept as history;
`npm run db:apply` remains for ad hoc SQL.

**Careful:** starting the app or the e2e suite migrates whatever database `.env` points at
(unless `POSTGRES_*` are set in the shell).

### Environment variables

| Variable | Project | Required | Notes |
|---|---|---|---|
| `POSTGRES_HOST/PORT/DB/USER/PASSWORD` | shared | yes | |
| `APP_URL` | shared | yes | Public origin of the API (e.g. `https://api.tasteep.eu`), prefixed to signed photo URLs |
| `PORT` | shared | no | default 3000 |
| `FRONTEND_URL` | shared | for the web app / admin | CORS origins, comma-separated, exact (`https://…`, no trailing slash) |
| `TASTEEP_JWT_SECRET` | Tasteep | yes | falls back to legacy `JWT_SECRET`; startup fails if neither is set |
| `TASTEEP_JWT_EXPIRES_IN` | Tasteep | no | default `365d` |
| `TASTEEP_SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | Tasteep | no | host unset → OTP logged to console; host set → `USER` and `PASS` required (startup fails otherwise) |
| `TASTEEP_OTP_TTL_MINUTES` / `_MAX_ATTEMPTS` / `_RESEND_COOLDOWN_SECONDS` | Tasteep | no | 10 / 5 / 60 |
| `TASTEEP_GOOGLE_CLIENT_IDS` | Tasteep | for Google login | comma-separated |
| `TASTEEP_DISCORD_CLIENT_ID/SECRET/REDIRECT_URI` | Tasteep | for Discord login | |
| `TASTEEP_NOMINATIM_USER_AGENT` | Tasteep | for geocoding | e.g. `Tasteep/1.0 (you@example.com)` |
| `TASTEEP_NOMINATIM_URL` | Tasteep | no | default public Nominatim |
| `TASTEEP_SMWS_SCRAPER_ENABLED` | Tasteep | no | default `true`; `false` → no nightly scrape |
| `TASTEEP_SMWS_REQUEST_INTERVAL_MS` | Tasteep | no | default `3000`; gap between requests to smws.eu |
| `TASTEEP_SMWS_USER_AGENT` | Tasteep | no | User-Agent sent to smws.eu |
| `TASTEEP_PHOTOS_DIR` | Tasteep | in production | default `./data/photos`; `/data/photos` in the image. Must be a persistent volume |
| `TASTEEP_PHOTO_URL_SECRET` | Tasteep | no | key for signing photo URLs; default derived from `TASTEEP_JWT_SECRET` |
| `TASTEEP_FEEDBACK_MAX_PER_HOUR` | Tasteep | no | default `5`; feedback messages per user per rolling hour |

## Postman

A ready-to-import collection lives in `postman/`:

- `Backend.postman_collection.json` — every route in this README, grouped into Tasteep Auth,
  Tasteep Tastings, Tasteep Aggregates & Geocode, Tasteep SMWS bottles and Admin.
- `local.postman_environment.json` — `base_url` plus the variables the requests need
  (`tasteep_email`, `tasteep_otp_code`, ...).

Import both in Postman, select the **Backend - Local** environment, then run **Tasteep — Auth
→ Request Email Code**, copy the code from the server log (or your inbox once SMTP is
configured) into the `tasteep_otp_code` variable, and run **Verify Email Code** — it saves the
bearer token into the environment automatically, so every other Tasteep request just works.

## Development

```bash
npm run test         # unit tests (jest, no database needed)
npm run test:cov
npm run lint         # ESLint with --fix (rewrites files)
npm run lint:check   # ESLint + prettier --check, no writes (what CI runs)
npm run build
```

Unit tests mock TypeORM repositories (`src/test-utils/mock-repository.factory.ts`) and cover
the OTP lifecycle, account resolution, session revocation, the tasting upsert and location
rules, the stats parsing, the geocode cache and the rate limiter.

### End-to-end tests (need Postgres)

```bash
npm run test:e2e
```

CI runs it on every pull request against an empty `postgres:18` service. Locally it uses the
database in `.env` unless `POSTGRES_*` are set in the shell, so the safest run is against a
throw-away container:

```bash
docker run -d --rm --name pg-e2e -e POSTGRES_PASSWORD=e2e -p 55432:5432 postgres:18
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55432 POSTGRES_USER=postgres POSTGRES_PASSWORD=e2e \
  POSTGRES_DB=postgres TASTEEP_JWT_SECRET=e2e TASTEEP_SMTP_HOST= npm run test:e2e
```

The suites share one database, so the script runs them serially (`--runInBand`).
`test/tasteep.e2e-spec.ts` boots the real app against that database and drives the
whole Tasteep contract over HTTP — JWT guard, validation pipe, list ordering, the unplaced
shelf, stats SQL, the manual-pin rules and the geocode cache. Only Nominatim is
stubbed (its usage policy forbids automated querying). The suite creates throw-away users and
deletes everything it made afterwards, so it is safe to run against a dev database. It sets
`NODE_ENV=test`, which turns TypeORM's SQL logging off. Booting the app runs the migrations, so
an empty database gets the whole schema.

### Postman / newman

`postman/Backend.postman_collection.json` + `postman/local.postman_environment.json`. The
*Tasteep — Tastings → Atlas (phase 2) → Cleanup* folders are an ordered, fully asserted
scenario (two tastings created, geocoded, pinned, aggregated, deleted). Run it headless against
a running server with a token from the email login. newman isn't a dev dependency (its
dependency tree carries unfixable audit findings); the script fetches it on demand with `npx`:

```bash
npm run start:dev                                  # in another shell; OTP is printed in its log
curl -X POST localhost:3000/auth/email -H 'content-type: application/json' -d '{"email":"you@example.com"}'
curl -X POST localhost:3000/auth/email/verify -H 'content-type: application/json' -d '{"email":"you@example.com","code":"123456"}'
TASTEEP_TOKEN=<token from the response> npm run test:postman
```

The first run geocodes "Islay, Scotland" through Nominatim for real (needs
`TASTEEP_NOMINATIM_USER_AGENT`); later runs are served from `tasteep_geocode_cache`.

To exercise the flow by hand against a throw-away database instead:

```bash
docker run -d --rm --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:18
POSTGRES_PASSWORD=dev TASTEEP_JWT_SECRET=dev APP_URL=http://localhost:3000 npm run start:dev
curl -X POST localhost:3000/auth/email -H 'content-type: application/json' -d '{"email":"you@example.com"}'
```

## Deployment

Three environments, each with its own Postgres 18 database and its own secrets, run on one
server managed with Coolify (private, reachable only on the Tailscale tailnet):

| Branch | Environment | API |
|---|---|---|
| `dev` | dev | `https://api.dev.tasteep.eu` |
| `preprod` | preprod | `https://api.preprod.tasteep.eu` |
| `prod` | prod | `https://api.tasteep.eu` |

`master` is not deployed: it only receives `prod` at major versions (tag `vX.0.0`).

`.github/workflows/ci-cd.yml`:

- **Pull request** into `dev`, `preprod` or `prod`: `npm run lint:check`, build, unit tests,
  then the e2e suite against a `postgres:18` service. Nothing is deployed.
- **Push** to one of those branches (or a manual run): the same checks, then the image, then
  the deploy.
  - The image is `ghcr.io/skidbiadnir/backend:tree-<git tree hash>`. When an image of that
    exact tree already exists, the build is skipped. A promotion PR (`dev` → `preprod` →
    `prod`) with no other change has the same tree, so preprod and prod run the very image
    tested on dev.
  - The moving tag `:dev` / `:preprod` / `:prod` is pointed at it, then CI joins the tailnet
    (Tailscale GitHub Action, ephemeral `tag:ci` node), asks Coolify to redeploy that
    environment, waits for the deployment to finish, and checks `GET /health` on the public
    URL.
- Docs-only changes (`**/*.md`, `docs/**`, `postman/**`) do not trigger it.

Runtime variables live in Coolify, not GitHub. The repository secrets are `TS_OAUTH_CLIENT_ID`,
`TS_OAUTH_SECRET`, `COOLIFY_URL`, `COOLIFY_TOKEN` and `COOLIFY_UUID_DEV` / `_PREPROD` / `_PROD`.

**Schema changes** need nothing by hand: each environment runs its pending migrations when the
new container boots. Take a `pg_dump` first when a migration rewrites or drops data. To inspect an
environment, open Coolify → that environment's backend → **Terminal** and run
`npm run migration:show` or `npm run migration:check`.

**Photos:** each backend has a persistent volume on `/data/photos`. The files are not in
Postgres, so back that volume up together with the database dump, off the server. Uploads
can be up to 20 MB; Coolify's Traefik sets no body limit by default.

To run the image locally:

```bash
docker build -t backend .
docker run -p 3000:3000 --env-file .env -v "$PWD/data/photos:/data/photos" backend
```

The image defaults to `NODE_ENV=production` and has a `HEALTHCHECK` on `/health`.

## Decisions & open items

- Email login = OTP code (no deep link needed on mobile). Tokens = long-lived JWT + revocable
  `tasteep_sessions` row. Google = ID-token verification, Discord = server-side code exchange.
- Photos are stored on the server's disk (one per tasting), served via signed URLs rather than the
  bearer token because Flutter web's `Image.network` cannot send one. Swap
  `PhotoStorageService` for object storage if the disk ever becomes the limit.
- `?unplaced=true` on the list endpoint was chosen over a separate `/unplaced` route.
- Settings columns (`theme_mode`, `score_scale`, `unit_system`, `currency`) exist on
  `tasteep_users` but have no endpoint yet.
