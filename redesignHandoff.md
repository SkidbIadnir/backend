# Tasteep backend — handoff

**Read this, don't build from the app repo blind.** This describes what the Flutter client
already assumes, what phase 1 (the five shipped screens) needs to stop being local-only, and
what phase 2 (the Atlas tab) will need on top. It is a prediction based on the client code and
the design handoff, not a spec that's been approved screen-by-screen — confirm anything
surprising with the project owner before committing to it.

## What exists today

Tasteep is a personal spirit-tasting journal (Flutter, iOS/Android). One user, their own
private records — not a social product. Five screens are built and pixel-complete: Login,
Tasting List, New Tasting, Tasting Detail, Profile. Right now everything is **local-only**:
`SharedPreferences` for tastings/session/settings, app-documents-dir for photos. There is no
backend. The client already has the shape of one baked in, though — see below.

The fourth nav tab, **Atlas**, is an inert placeholder (`lib/screens/atlas_screen.dart`). It's
fully designed (three views: Flavour, Places, Cabinet) but explicitly not-yet-built on the
client side either. This doc covers backend needs for both: phase 1 (make the five real screens
sync) and phase 2 (support the Atlas once someone builds it).

## What the client already assumes — don't diverge without a reason

`lib/services/api/api_config.dart`:

```dart
baseUrl = 'https://api.skidhub.fr'
tastings   = '/tasteep/tastings'
authMe     = '/auth/me'
authEmail  = '/auth/email'
authGoogle = '/auth/google'
authDiscord = '/auth/discord'
```

`lib/services/api/api_client.dart` is a thin JSON client: `Authorization: Bearer <token>` header
when a token is present, `Content-Type/Accept: application/json`, 10s timeout, non-2xx → throws
with status + raw body. So: **bearer-token auth**, plain JSON, no envelope — return the resource
directly, not `{data: ...}` wrappers, since the client does `jsonDecode(response.body)` and
hands it straight to `Model.fromJson`.

`lib/models/tasting.dart` — JSON keys are **snake_case**, dates are **ISO 8601 strings**. This
is the exact contract the API must produce and accept:

```
id (string), name (string, required)
category: "whisky" | "rum" | "agave" | "other"   (default "whisky")
photo_path (string?), distillery (string?), region (string?)
abv (number?), price (number?), age_statement (string?), cask_type (string?)
date_tasted (ISO8601?), location (string?)
score (int 0-100?), appearance (string?), tags (string[])
nose (string?), palate (string?), finish (string?)
lat (number?), lon (number?)
location_precision: "exact" | "region" | "country" | "manual" | "unknown"
created_at (ISO8601?), updated_at (ISO8601?)
```

Every field except `id`, `name`, `category` is nullable — this is a journal, not a policed form.
`lat`/`lon`/`location_precision` are already on the model *now*, ahead of the Atlas being built,
specifically so phase 2 doesn't need a migration. Keep them.

`lib/models/auth_user.dart`:

```
id (string), display_name (string), provider: "email" | "google" | "discord",
email (string?), token (string?)
```

`RemoteTastingRepository` (`lib/services/tasting_repository.dart`) is already stubbed:
`GET /tasteep/tastings` → list, `PUT /tasteep/tastings/:id` (upsert, not POST — the client
always sends its own id), `DELETE /tasteep/tastings/:id`. Photo storage is still local-only on
the client (`storePhoto`/`removePhoto` copy files on-device); there is **no upload call yet**,
which is the first real gap — see Endpoints below.

## Datastore: PostgreSQL (existing — stay on it)

The project already runs Postgres; there's no data shape here that argues for moving off it.
Every record is a flat, mostly-nullable row scoped to one owner (`user_id`) — textbook
relational modeling. Prefer this over a NoSQL move: `tags` fits `text[]` (or a join table if you
ever want tag-level queries), phase 2's stats/cabinet views are one `GROUP BY` each instead of an
aggregation-pipeline rewrite, and **PostGIS** gives the Places view real geo indexing
(`ST_DWithin`, bounding-box queries) that's a better fit for lat/lon + precision than anything a
document store offers out of the box. Enable the `postgis` extension now if geo queries beyond
"store a point" ever look likely — cheap to add early, annoying to bolt on later.

### `users`

```sql
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text UNIQUE,              -- null for OAuth accounts w/o email scope
  display_name    text NOT NULL,
  provider        text NOT NULL CHECK (provider IN ('email', 'google', 'discord')),
  provider_id     text NOT NULL,            -- OAuth subject / provider account id
  password_hash   text,                     -- only if email+password rather than magic link — see Auth below
  theme_mode      text NOT NULL DEFAULT 'light',
  score_scale     text NOT NULL DEFAULT 'hundred',
  unit_system     text NOT NULL DEFAULT 'metric',
  currency        text NOT NULL DEFAULT '£',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);
```

`avatar_initials` isn't a column — it's derivable client-side (`AuthUser.initials`), don't
store it. The four settings columns mirror `SettingsProvider`'s local `SharedPreferences` keys;
see the sync note below before treating them as load-bearing.

### `tastings`

```sql
CREATE TABLE tastings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                text NOT NULL,
  category            text NOT NULL DEFAULT 'whisky'
                        CHECK (category IN ('whisky', 'rum', 'agave', 'other')),
  photo_url           text,
  distillery          text,
  region              text,
  abv                 numeric,
  price               numeric,
  age_statement       text,
  cask_type           text,
  date_tasted         timestamptz,
  location            text,
  score               smallint CHECK (score BETWEEN 0 AND 100),
  appearance          text,
  tags                text[] NOT NULL DEFAULT '{}',
  nose                text,
  palate              text,
  finish              text,
  lat                 double precision,
  lon                 double precision,
  location_precision  text NOT NULL DEFAULT 'unknown'
                        CHECK (location_precision IN ('exact', 'region', 'country', 'manual', 'unknown')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tastings_user_date_idx ON tastings (user_id, date_tasted DESC);
CREATE INDEX tastings_user_category_idx ON tastings (user_id, category);
```

If full-text note search ships later, a `tsvector` generated column over
`name, distillery, region, nose, palate, finish` with a GIN index is the natural addition —
no extension needed beyond core Postgres. If PostGIS is enabled, a generated
`geography(Point)` column from `(lon, lat)` is worth adding once the Places view is real —
until then, plain `double precision` columns are fine.

**Field name note:** the client's `photo_path` is a local filesystem path today. The backend
should own `photo_url` (a served URL) and the API layer should map `photo_url` → the JSON key
`photo_path` the client already deserializes, *or* — cleaner — ask whoever wires up the client
for this phase to rename the Dart field to `photoUrl`/`photo_url` once photos are remote. Flag
this explicitly rather than silently picking one; it's a one-line client change either way.

### `geocode_cache` (phase 2, Places)

The design handoff is explicit: geocode on demand via Nominatim, **cache the result on the
tasting, never re-query**, respect the 1 req/sec + real User-Agent policy. A cache keyed on the
query string still helps across users/tastings hitting the same distillery name:

```sql
CREATE TABLE geocode_cache (
  query        text PRIMARY KEY,   -- normalized/lowercased
  lat          double precision NOT NULL,
  lon          double precision NOT NULL,
  precision    text NOT NULL,
  provider     text NOT NULL DEFAULT 'nominatim',
  resolved_at  timestamptz NOT NULL DEFAULT now()
);
```

No TTL/expiry needed — coordinates for a named place don't go stale — but `resolved_at` is kept
in case you ever want to invalidate manually.

### Sessions / refresh tokens

If you go with short-lived JWT + refresh rather than opaque long-lived bearer tokens, a
`sessions` table (`id, user_id, refresh_token_hash, created_at, expires_at, revoked_at`) is the
usual shape. If you'd rather keep it simple for a personal-use app, a long-lived signed JWT with
no server-side session table is defensible too — the client just stores whatever
`AuthUser.token` it's given and replays it as a bearer token forever until sign-out. Your call;
flag it as a decision point rather than assuming.

## Endpoints — phase 1 (make the five shipped screens real)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/email` | Body `{email}`. Magic-link or OTP flow — decide which; the client just awaits a resolved `AuthUser`. If magic-link, this endpoint sends the email and a *second* endpoint (e.g. `/auth/email/callback?token=`) completes it and returns the `AuthUser`. |
| `POST` | `/auth/google` | Body carries the Google ID token / auth code from the client's OAuth flow; verify server-side, upsert the `users` row, return `AuthUser` incl. bearer token. |
| `POST` | `/auth/discord` | Same shape, Discord OAuth code exchange. |
| `GET` | `/auth/me` | Bearer-authed. Returns the current `AuthUser` — used to restore session / validate a stored token on app start. |
| `POST` | `/auth/signout` | Not in `ApiConfig` yet but needed once sessions/refresh tokens exist server-side; revoke the token. Client-side sign-out currently just drops the local copy. |
| `GET` | `/tasteep/tastings` | List all tastings for the authed user, newest `date_tasted` first (matches client sort). Consider `?since=` for incremental sync later; not needed for v1. |
| `PUT` | `/tasteep/tastings/:id` | Upsert — client always generates its own id (likely a UUID) and always PUTs, for both create and update. Set `created_at` server-side only on first insert; always bump `updated_at`. |
| `DELETE` | `/tasteep/tastings/:id` | Also delete the associated photo if you're doing storage cleanup. |
| `POST` | `/tasteep/tastings/:id/photo` | **New — not yet in the client.** Multipart upload, returns `{photo_url}` (or updates the tasting directly and returns it). This is the actual gap: the client has local photo storage but no upload path. Needed before "add a tasting" is meaningfully cloud-backed. |

Auth flow detail worth deciding early: does `/auth/google` and `/auth/discord` take an
authorization *code* (server does the token exchange) or an already-exchanged provider access
token (client does the exchange via `google_sign_in`/`flutter_discord_oauth2` and just hands the
backend a token to verify)? Either works; the code-exchange path is safer (client secret never
leaves the server) and is the more common mobile pattern.

## Endpoints — phase 2 (Atlas — do not build the client for this yet, but the API can exist)

The Atlas is three views over the *same* `tastings` table — Flavour, Places, Cabinet. Per the
design handoff, flavour-axis positioning and jitter are **client-side, pure-presentation logic**
(a static tag → vector lookup) — no backend endpoint needed for the flavour map itself, it
consumes the same `GET /tasteep/tastings` list phase 1 already provides.

Where the backend does real work:

| Method | Path | Notes |
|---|---|---|
| `POST` | `/tasteep/geocode` | Body `{query}` (distillery name or region string). Server checks `geocode_cache` first; on miss, calls Nominatim respecting rate limit, stores the result, returns `{lat, lon, precision}`. Keeps the Nominatim policy (1 req/s, real User-Agent, no bulk pre-geocoding) enforceable in one place instead of trusting every client install. |
| `PUT` | `/tasteep/tastings/:id/location` | Manual pin-drop save — body `{lat, lon, precision: "manual"}`. Per the handoff, a `manual` precision must never be silently overwritten by a later automated geocode — enforce that server-side (reject/ignore an automated update if current precision is already `manual`), don't rely on the client to gate it. |
| `GET` | `/tasteep/tastings/unplaced` | Convenience filter for the "N NOT PLACED" shelf — `location_precision in [unknown, country]` (handoff distinguishes `SET LOCATION` for `unknown`/nothing vs `REFINE` for `region`/`country`). Could equally be a query param on the main list endpoint (`?unplaced=true`) rather than a separate route — either is fine, just pick one. |
| `GET` | `/tasteep/stats` | Backs the Profile stat grid (tastings count, avg score, distinct distilleries) — currently computed client-side from the full list, which is fine at small N but won't scale once sync + Atlas both want aggregate views. A single aggregation endpoint returning `{count, avg_score, distinct_distilleries}` avoids duplicating that logic in two places. |
| `GET` | `/tasteep/cabinet` | Groups tastings by distillery with a per-group average score, for the Cabinet view. Trivial SQL: `SELECT distillery, count(*), avg(score) FROM tastings WHERE user_id = $1 GROUP BY distillery`. Undesigned on the client per the handoff, so this is a reasonable guess at shape, not a locked contract. |

Everything else about the Atlas — the flavour-vector table, the map projection, pin rendering —
is Flutter-side `CustomPainter` work per the handoff and touches this backend not at all.

## Cross-cutting notes

- **Auth gates everything.** Every `/tasteep/*` route is bearer-authed and scoped to
  `user_id` from the token — there is no cross-user read path anywhere in this product, by
  design (it's explicitly not social).
- **No pagination needed yet.** A personal journal's tastings list is small (tens to low
  hundreds). Don't build cursor pagination speculatively; add it if `GET /tastings` response
  size ever becomes a real problem.
- **Settings sync is optional, not assumed.** `theme_mode`/`score_scale`/`unit_system`/`currency`
  are local-only today (`SharedPreferences`). Syncing them via the `users` columns above is a
  nice-to-have for multi-device use, not something the client currently calls out to — don't
  build an endpoint for it unless asked; they're in the schema only so the columns exist if wanted.
- **Photo storage backend** (S3-compatible bucket, Cloudflare R2, or similar) is undecided —
  whatever you pick, the contract the client needs back is just a stable `photo_url` per
  tasting. Signed upload URLs vs. direct multipart-through-the-API is an implementation choice,
  not something the client's current code constrains.
- **Rate limiting Nominatim is a server responsibility**, not a client one — see the geocode
  endpoint above. This is the one hard external constraint in the whole spec (1 req/sec, real
  User-Agent, ToS-compliant, no bulk pre-geocoding of a distillery table).

## Open questions to raise with the project owner before implementing

1. Email auth: magic link vs. OTP vs. password? (`AuthProviderKind.email` exists but the flow
   past "enter your email" isn't designed.)
2. JWT+refresh vs. long-lived opaque token — affects whether a `sessions` table is needed.
3. OAuth: server-side code exchange vs. client-side token verification, for both Google and
   Discord.
4. Where photos actually live (S3/R2/GCS/other) — cost and account-setup decision, not a code
   one.
5. Whether `GET /tasteep/tastings/unplaced` is worth being its own route vs. a query param.