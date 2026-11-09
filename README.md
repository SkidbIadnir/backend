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
├── test-utils/              generic jest mocks (repository / query-builder)
│
├── tasteep/
│   ├── tasteep.module.ts
│   ├── tasteep-config.ts    every TASTEEP_* env var in one place
│   ├── entities/            tasteep_users, tasteep_sessions, tasteep_email_otps,
│   │                        tasteep_tastings, tasteep_geocode_cache, tasteep_regions
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
│   ├── tastings/            /tasteep/tastings, /tasteep/stats
│   │   ├── tastings.controller.ts / .service.ts / .module.ts
│   │   ├── tasting.mapper.ts            entity ⇄ snake_case JSON contract
│   │   └── dto/
│   ├── geocode/             /tasteep/geocode — cache-first Nominatim with a 1 req/s limiter
│   ├── regions/             /tasteep/regions — curated country/subregion picker, seeded from data/region.json
│   ├── smws-codes/          /tasteep/smws-codes — SMWS code → distillery list, seeded from data/smws-codes.json
│   ├── smws-bottles/        /tasteep/smws-bottles — bottles read from smws.eu (see below)
│   │   ├── smws-http.client.ts          plain HTTP to smws.eu: sitemap + product pages, 3 s apart
│   │   ├── smws-product.parser.ts       pure: product page HTML → raw fields (cheerio)
│   │   ├── smws-catalog.rules.ts        pure: raw fields → bottle, merge that never loses a value
│   │   ├── smws-bottle-sync.service.ts  one run: lock, discover, stock check, relist sweep
│   │   ├── smws-bottles.service.ts      reads for the app and the admin status
│   │   └── smws-scrape.scheduler.ts     nightly cron
│   ├── wishlist/            /tasteep/wishlist — folders and items
│   └── test-utils/          Tasteep fixtures
│
└── admin/                   /admin/* dashboard API (stats, users, tastings, SMWS, codes, regions, logs)

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

- `photo_path` instead of `photo_url`: photos stay on the device for now, so the column holds
  whatever opaque string the client sends and echoes it back. No upload endpoint exists.
- `tasteep_geocode_cache.lat/lon` are nullable: misses are cached as `unknown` so a place
  Nominatim cannot resolve is never asked for again.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
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
| `GET` | `/tasteep/stats` | `{count, avg_score, distinct_distilleries}` |
| `POST` | `/tasteep/geocode` | `{query}` → `{lat, lon, precision}` |
| `GET` | `/tasteep/regions` | Country → subregion tree with centroids, ETag/304 |

Request/response details, status codes and the location-precision rules are in
[docs/tasteep-api.md](./docs/tasteep-api.md).

### Rules enforced server-side

- Everything under `/tasteep/*` is scoped to the user in the token; there is no cross-user read.
- A `manual` location pin is never overwritten by an automated geocode, whether it arrives via
  the location endpoint (`409`) or inside a full `PUT` (the stored pin is kept).
- Nominatim is called at most once per second for the whole server, always with the
  identifying `TASTEEP_NOMINATIM_USER_AGENT`, and every result (including "not found") is
  cached forever. Identical concurrent queries share one upstream request.

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
3. **Relist sweep:** bottles sold out in the last 30 days are re-read weekly.
4. Pages read as `other` are re-read monthly.

Bottles are keyed by the shop's **SKU**, so blends without a cask code (`kind = blend`, e.g.
Fruit Bomb, `batch = "Batch 40"`) are stored next to single casks (`kind = single_cask`,
`code = 1.309`). Each field is read from the visible info list first (same format as before),
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

Requirements: Node 20+, PostgreSQL 14+. Outside production (`NODE_ENV !== 'production'`)
TypeORM `synchronize` creates and alters tables on boot; in production apply the schema
yourself or run once with synchronize before switching the flag.

### Environment variables

| Variable | Project | Required | Notes |
|---|---|---|---|
| `POSTGRES_HOST/PORT/DB/USER/PASSWORD` | shared | yes | |
| `APP_URL` | shared | yes | Public base URL, used for OAuth callbacks |
| `PORT` | shared | no | default 3000 |
| `FRONTEND_URL` | shared | no | CORS origins, comma-separated |
| `TASTEEP_JWT_SECRET` | Tasteep | yes | falls back to `JWT_SECRET` |
| `TASTEEP_JWT_EXPIRES_IN` | Tasteep | no | default `365d` |
| `TASTEEP_SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | Tasteep | no | unset → OTP logged to console |
| `TASTEEP_OTP_TTL_MINUTES` / `_MAX_ATTEMPTS` / `_RESEND_COOLDOWN_SECONDS` | Tasteep | no | 10 / 5 / 60 |
| `TASTEEP_GOOGLE_CLIENT_IDS` | Tasteep | for Google login | comma-separated |
| `TASTEEP_DISCORD_CLIENT_ID/SECRET/REDIRECT_URI` | Tasteep | for Discord login | |
| `TASTEEP_NOMINATIM_USER_AGENT` | Tasteep | for geocoding | e.g. `Tasteep/1.0 (you@example.com)` |
| `TASTEEP_NOMINATIM_URL` | Tasteep | no | default public Nominatim |
| `TASTEEP_SMWS_SCRAPER_ENABLED` | Tasteep | no | default `true`; `false` → no nightly scrape |
| `TASTEEP_SMWS_REQUEST_INTERVAL_MS` | Tasteep | no | default `3000`; gap between requests to smws.eu |
| `TASTEEP_SMWS_USER_AGENT` | Tasteep | no | User-Agent sent to smws.eu |

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
npm run test        # unit tests (jest, no database needed)
npm run test:cov
npm run lint
npm run build
```

Unit tests mock TypeORM repositories (`src/test-utils/mock-repository.factory.ts`) and cover
the OTP lifecycle, account resolution, session revocation, the tasting upsert and location
rules, the stats parsing, the geocode cache and the rate limiter.

### End-to-end tests (need Postgres)

```bash
npm run test:e2e
```

`test/tasteep.e2e-spec.ts` boots the real app against the database in `.env` and drives the
whole Tasteep contract over HTTP — JWT guard, validation pipe, list ordering, the unplaced
shelf, stats SQL, the manual-pin rules and the geocode cache. Only Nominatim is
stubbed (its usage policy forbids automated querying). The suite creates throw-away users and
deletes everything it made afterwards, so it is safe to run against a dev database. It sets
`NODE_ENV=test`, which keeps schema sync on but turns TypeORM's SQL logging off.

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
docker run -d --rm --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine
POSTGRES_PASSWORD=dev TASTEEP_JWT_SECRET=dev APP_URL=http://localhost:3000 npm run start:dev
curl -X POST localhost:3000/auth/email -H 'content-type: application/json' -d '{"email":"you@example.com"}'
```

## Docker / CI

```bash
docker build -t backend .
docker run -p 3000:3000 --env-file .env backend
```

`.github/workflows/ci-cd.yml` runs `npm test`, then builds and pushes the image to `ghcr.io`
on every push to `master`.

## Decisions & open items

- Email login = OTP code (no deep link needed on mobile). Tokens = long-lived JWT + revocable
  `tasteep_sessions` row. Google = ID-token verification, Discord = server-side code exchange.
- Photos remain on-device; `photo_path` is opaque. Add an upload endpoint + object storage
  when a home for the files is chosen.
- `?unplaced=true` on the list endpoint was chosen over a separate `/unplaced` route.
- Settings columns (`theme_mode`, `score_scale`, `unit_system`, `currency`) exist on
  `tasteep_users` but have no endpoint yet.
