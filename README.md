# Backend — Tasteep & SMWS Watchtower

One NestJS process, one PostgreSQL database, **two completely independent projects**:

| Project | Folder | Tables | Routes | JWT audience |
|---|---|---|---|---|
| **Tasteep** — spirit-tasting journal behind the Flutter app | `src/tasteep/` | `tasteep_*` | `/auth/*`, `/tasteep/*` | `tasteep` |
| **SMWS Watchtower** — scrapes smws.eu and serves the inventory to a website | `src/smws/` | `smws_*` | `/smws/*` | none (no auth) |

Nothing in `src/tasteep/` imports from `src/smws/` or vice versa. Tasteep owns users, auth
and JWTs; SMWS has no users at all. The only shared code is the root wiring
(`app.module.ts`, `main.ts`) and a generic jest helper (`src/test-utils/`).

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
│   │                        tasteep_tastings, tasteep_geocode_cache
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
│   ├── tastings/            /tasteep/tastings, /tasteep/stats, /tasteep/cabinet
│   │   ├── tastings.controller.ts / .service.ts / .module.ts
│   │   ├── tasting.mapper.ts            entity ⇄ snake_case JSON contract
│   │   └── dto/
│   ├── geocode/             /tasteep/geocode — cache-first Nominatim with a 1 req/s limiter
│   └── test-utils/          Tasteep fixtures
│
└── smws/
    ├── smws.module.ts
    ├── entities/            smws_live, smws_archive, smws_lookout, smws_distilleries
    ├── scraper/             Playwright scraper, cron jobs, API-key-guarded manual triggers
    ├── watchtower/          /smws/watchtower/live and /archive — public read endpoints
    ├── postgres/            distillery seed / purge helpers
    ├── data/                distillery reference JSON
    └── test-utils/          SMWS fixtures

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
| `GET` | `/tasteep/cabinet` | Per-distillery `{distillery, count, avg_score}` |
| `POST` | `/tasteep/geocode` | `{query}` → `{lat, lon, precision}` |

Request/response details, status codes and the location-precision rules are in
[docs/tasteep-api.md](./docs/tasteep-api.md).

### Rules enforced server-side

- Everything under `/tasteep/*` is scoped to the user in the token; there is no cross-user read.
- A `manual` location pin is never overwritten by an automated geocode, whether it arrives via
  the location endpoint (`409`) or inside a full `PUT` (the stored pin is kept).
- Nominatim is called at most once per second for the whole server, always with the
  identifying `TASTEEP_NOMINATIM_USER_AGENT`, and every result (including "not found") is
  cached forever. Identical concurrent queries share one upstream request.

## SMWS Watchtower

A scraper and a public read-only feed, nothing else: no users, no auth, no notifications.
The Playwright scraper runs on a schedule (live inventory daily at midnight, archive every
2 days at 01:00) and writes to `smws_live` / `smws_archive`; the website reads them back.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/smws/watchtower/live` | none | Bottles currently listed on smws.eu, newest first |
| `GET` | `/smws/watchtower/archive` | none | Every bottle the archive scraper has seen, newest first |
| `GET` | `/smws/scraper/run-live` | `x-api-key` | Run the live scraper now |
| `GET` | `/smws/scraper/run-archive` | `x-api-key` | Run the archive scraper now |

The manual triggers require the `x-api-key` header to equal `SMWS_SCRAPER_API_KEY`; when
that variable is unset they answer `403` and only the cron schedule runs the scraper.

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
| `POSTGRES_HOST/PORT/DB/USER/PASSWORD` | both | yes | |
| `APP_URL` | both | yes | Public base URL, used for OAuth callbacks |
| `PORT` | both | no | default 3000 |
| `FRONTEND_URL` | both | no | CORS origins, comma-separated |
| `TASTEEP_JWT_SECRET` | Tasteep | yes | falls back to `JWT_SECRET` |
| `TASTEEP_JWT_EXPIRES_IN` | Tasteep | no | default `365d` |
| `TASTEEP_SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | Tasteep | no | unset → OTP logged to console |
| `TASTEEP_OTP_TTL_MINUTES` / `_MAX_ATTEMPTS` / `_RESEND_COOLDOWN_SECONDS` | Tasteep | no | 10 / 5 / 60 |
| `TASTEEP_GOOGLE_CLIENT_IDS` | Tasteep | for Google login | comma-separated |
| `TASTEEP_DISCORD_CLIENT_ID/SECRET/REDIRECT_URI` | Tasteep | for Discord login | |
| `TASTEEP_NOMINATIM_USER_AGENT` | Tasteep | for geocoding | e.g. `Tasteep/1.0 (you@example.com)` |
| `TASTEEP_NOMINATIM_URL` | Tasteep | no | default public Nominatim |
| `SMWS_SCRAPER_API_KEY` | SMWS | no | unset → manual scraper triggers disabled |

## Postman

A ready-to-import collection lives in `postman/`:

- `Backend.postman_collection.json` — every route in this README, grouped into Tasteep Auth,
  Tasteep Tastings, Tasteep Aggregates & Geocode, SMWS Watchtower and SMWS Scraper.
- `local.postman_environment.json` — `base_url` plus the variables the requests need
  (`tasteep_email`, `tasteep_otp_code`, `scraper_api_key`, ...).

Import both in Postman, select the **Backend - Local** environment, then run **Tasteep — Auth
→ Request Email Code**, copy the code from the server log (or your inbox once SMTP is
configured) into the `tasteep_otp_code` variable, and run **Verify Email Code** — it saves the
bearer token into the environment automatically, so every other Tasteep request just works.
SMWS's watchtower requests need no auth; its scraper triggers need `scraper_api_key` set to
match `SMWS_SCRAPER_API_KEY`.

## Development

```bash
npm run test        # unit tests (jest, no database needed)
npm run test:cov
npm run lint
npm run build
```

Unit tests mock TypeORM repositories (`src/test-utils/mock-repository.factory.ts`) and cover
the OTP lifecycle, account resolution, session revocation, the tasting upsert and location
rules, the stats/cabinet parsing, the geocode cache and the rate limiter.

To exercise the real HTTP flow against a database, run Postgres in Docker and point the
env at it; without SMTP configured the login code is printed in the server log:

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
- SMWS lost its Discord login, alerts and push notifications on purpose: it only feeds a
  website now. The old `users`, `user_alerts`, `smws_users` and `tastings` tables are not
  migrated; drop them manually if they still exist in a database created by earlier versions.
