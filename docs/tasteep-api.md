# Tasteep API — client contract

Base URL: `https://api.skidhub.fr` (`ApiConfig.baseUrl`). Plain JSON, no envelope, snake_case
keys, ISO 8601 dates. Every route except the login ones needs `Authorization: Bearer <token>`.

Errors are Nest's default shape: `{"statusCode": 401, "message": "...", "error": "Unauthorized"}`.
Validation failures are `400` with `message` as an array of strings.

---

## Models

### `AuthUser`

```json
{
  "id": "1236ee75-…",
  "display_name": "nina",
  "provider": "email",          // "email" | "google" | "discord"
  "email": "nina@example.com",  // may be null for OAuth accounts without a verified email
  "token": "eyJ…"               // present on login responses, null on GET /auth/me
}
```

### `Tasting`

Exactly `lib/models/tasting.dart`. Every field except `id`, `name`, `category`, `tags`,
`location_precision` may be `null`.

```json
{
  "id": "aaaaaaaa-0000-4000-8000-000000000001",
  "name": "Lagavulin 16",
  "category": "whisky",                  // "whisky" | "rum" | "agave" | "other"
  "photo_path": "/data/user/0/…/a.jpg",  // opaque client-side path, stored & echoed as-is
  "distillery": "Lagavulin",
  "region": "Islay",
  "abv": 43,
  "price": 65.5,
  "age_statement": "16",
  "cask_type": null,
  "date_tasted": "2026-03-10T19:00:00.000Z",
  "location": "Home",
  "score": 88,                           // int 0–100
  "appearance": null,
  "tags": ["peat", "smoke"],
  "nose": "Bonfire",
  "palate": null,
  "finish": "Long",
  "lat": null,
  "lon": null,
  "location_precision": "unknown",       // "exact" | "region" | "country" | "manual" | "unknown"
  "created_at": "2026-09-05T14:46:29.076Z",
  "updated_at": "2026-09-05T14:46:30.106Z"
}
```

---

## Auth

### Email (6-digit code)

| Step | Request | Response |
|---|---|---|
| 1 | `POST /auth/email` `{"email": "nina@example.com"}` | `200 {"status":"code_sent","email":"nina@example.com","expires_in":600}` |
| 2 | `POST /auth/email/verify` `{"email": "nina@example.com", "code": "123456"}` | `200 AuthUser` (with `token`) |

- Email is trimmed and lower-cased server-side.
- Step 1 answers `429 {"message": "...", "retry_after": 42}` when a code was sent less than
  60 s ago.
- Step 2 answers `401` for a wrong code (5 attempts, then the code is dead), an expired code
  (10 min) or when no code was requested.
- First login creates the account; `display_name` defaults to the part before `@`.

### Google

`POST /auth/google` `{"id_token": "<ID token from google_sign_in>"}` → `200 AuthUser`.

The server verifies the token against `TASTEEP_GOOGLE_CLIENT_IDS`. `503` if that is not
configured, `401` if the token is invalid. If the Google email is verified and already belongs
to an existing account (e.g. one created via email login), you are signed into that account.

### Discord

1. Open `GET /auth/discord` in a browser (optionally `?redirect_uri=…`); it redirects to
   Discord's consent page with scope `identify email`.
2. Discord redirects to the app's registered URI (`TASTEEP_DISCORD_REDIRECT_URI`, e.g.
   `tasteep://auth/discord?code=…`).
3. `POST /auth/discord` `{"code": "…", "redirect_uri": "tasteep://auth/discord"}` → `200 AuthUser`.
   `redirect_uri` is optional when it equals the server default; it must match what step 1 used.

### Session

| Request | Response |
|---|---|
| `GET /auth/me` | `200 AuthUser` with `token: null`. `401` if the token is expired, unknown, or signed out. |
| `POST /auth/signout` | `204`. Revokes **this** token server-side. |

Tokens are JWTs valid for 365 days by default and carry a session id; sign-out marks that
session revoked, so a stored token stops working immediately.

---

## Tastings

All scoped to the authenticated user; other users' rows are invisible (404).

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/tasteep/tastings` | — | `200 Tasting[]`, newest `date_tasted` first, undated last |
| `GET` | `/tasteep/tastings?unplaced=true` | — | Same, only `location_precision` in `unknown`, `country` (the "NOT PLACED" shelf) |
| `GET` | `/tasteep/tastings/:id` | — | `200 Tasting` / `404` |
| `PUT` | `/tasteep/tastings/:id` | `Tasting` (see below) | `200 Tasting` |
| `DELETE` | `/tasteep/tastings/:id` | — | `204` / `404` |
| `PUT` | `/tasteep/tastings/:id/location` | `{"lat", "lon", "precision"}` | `200 Tasting` / `409` |

### `PUT /tasteep/tastings/:id` — upsert

- `:id` must be a UUID; the client generates it. First PUT creates, later PUTs replace.
- **Full replacement**: a key that is missing or `null` is stored as `null` (`tags` → `[]`,
  `category` → `"whisky"`, `location_precision` → `"unknown"`). Always send the whole object.
- `id`, `created_at`, `updated_at` in the body are ignored. `created_at` is set once,
  `updated_at` bumps on every PUT.
- `409` if the id already exists under another account.
- A row whose `location_precision` is `manual` keeps its pin: if the body carries an
  automated precision (`exact`/`region`/`country`), the stored `lat`/`lon`/`manual` win.
  Sending `"manual"` with new coordinates moves the pin.

### `PUT /tasteep/tastings/:id/location`

| `precision` | Effect |
|---|---|
| `manual` | Pin drop. `lat`/`lon` required. Always accepted. |
| `exact` / `region` / `country` | Automated geocode result. `lat`/`lon` required. `409` if the tasting is already `manual`. |
| `unknown` | Clears the location (`lat`/`lon` → `null`). Accepted even over a manual pin. |

---

## Aggregates (Profile / Atlas)

| Method | Path | Response |
|---|---|---|
| `GET` | `/tasteep/stats` | `{"count": 12, "avg_score": 84.7, "distinct_distilleries": 7}` — `avg_score` is `null` when no scored tasting exists |
| `GET` | `/tasteep/cabinet` | `[{"distillery": "Lagavulin", "count": 3, "avg_score": 88.3}, {"distillery": null, "count": 1, "avg_score": null}]` sorted by count desc |

---

## Geocoding

`POST /tasteep/geocode` `{"query": "Lagavulin distillery"}`

| Status | Body |
|---|---|
| `200` | `{"lat": 55.7585802, "lon": -6.1656723, "precision": "region"}` |
| `404` | no result (also cached, so the same query never hits Nominatim again) |
| `503` | server has no `TASTEEP_NOMINATIM_USER_AGENT` configured |

`precision` is derived from what Nominatim matched: a country → `country`, a
state/region/county/island → `region`, anything more specific → `exact`. Results are cached
server-side forever and Nominatim is called at most once per second for the whole server, so
clients may call this freely; they should still store the result on the tasting via
`PUT /tasteep/tastings/:id/location` and not re-ask.

---

## What the Flutter client needs to change

1. **Email login is two steps.** `POST /auth/email` no longer resolves an `AuthUser`; it
   returns `{"status": "code_sent"}` and the app must show a code entry, then call
   `POST /auth/email/verify`.
2. **Google:** send `{"id_token": …}`. **Discord:** send `{"code": …, "redirect_uri": …}`.
3. **Sign-out** should call `POST /auth/signout` before dropping the local token.
4. `photo_path` is stored verbatim; photos are not uploaded. There is no photo endpoint yet.
