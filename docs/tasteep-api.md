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
  "region": "Islay",                     // free text, kept verbatim
  "region_id": "scotland/islay",         // link into GET /tasteep/regions, or null
  "smws_sku": null,                      // SMWS bottle it is of (GET /tasteep/smws-bottles/:sku), or null
  "smws_label": null,                    // read-only: that bottle's code, batch or name ("29.311"), or null
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
| `GET` | `/tasteep/tastings?smws_sku=…` | — | Same, only the tastings of one SMWS bottle |
| `GET` | `/tasteep/tastings?smws_distillery=29` | — | Same, only the tastings of one SMWS distillery code |
| `GET` | `/tasteep/tastings/:id` | — | `200 Tasting` / `404` |
| `GET` | `/tasteep/tastings/prefill/:bottle` | — | `200 TastingPrefill` / `404` (see [Adding a tasting from an SMWS bottle](#adding-a-tasting-from-an-smws-bottle)) |
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
- **Region.** `region` is free text and is never altered. `region_id` links the tasting to
  the picker (see [Regions](#regions)):
  - `region_id` set → it must exist (`400 Unknown region_id "…"` otherwise). If `region` is
    null/empty the server fills it with that region's name.
  - `region_id` null → the server tries to match `region` by name, case-insensitively,
    whole string first and then each `,`/`/`-separated part; a subregion beats its
    country (`"Islay"`, `"Islay, Scotland"` and `"Scotland / Speyside"` all link). A few
    aliases are known (`Highlands`, `Lowlands`, `USA`). No match → `region_id: null`,
    text untouched. Typing anything is always allowed.
- **SMWS bottle.** `smws_sku` links the tasting to a catalog bottle. It is the one key that
  does not follow full replacement:
  - a SKU or cask code (`"29.311"`) → it must exist (`400 Unknown smws_sku "…"`); the SKU is
    stored;
  - `null` → unlinked;
  - **key left out** → the stored link is kept, so an app version without the field does
    not erase it. With no stored link, a name starting with a cask code
    (`"29.311 Diesel à la crème"`, `"SMWS 1.309"`) links that bottle.
  - `smws_label` is computed by the server (the bottle's `code`, else `batch`, else `name`)
    and ignored in the body.

### `PUT /tasteep/tastings/:id/location`

| `precision` | Effect |
|---|---|
| `manual` | Pin drop. `lat`/`lon` required. Always accepted. |
| `exact` / `region` / `country` | Automated geocode result. `lat`/`lon` required. `409` if the tasting is already `manual`. |
| `unknown` | Clears the location (`lat`/`lon` → `null`). Accepted even over a manual pin. |

`400` when `precision` is missing/unknown, when `lat`/`lon` are out of range, or when they are
absent for any precision other than `unknown`. The response is always the full updated `Tasting`.

Typical Atlas flow: `POST /tasteep/geocode {query}` → `PUT …/location` with the `{lat, lon,
precision}` it returned. The "NOT PLACED" shelf is `GET /tasteep/tastings?unplaced=true`
(`unknown` → *set location*, `country` → *refine*); placing a tasting removes it from the shelf,
clearing it puts it back.

---

## Aggregates (Profile)

| Method | Path | Response |
|---|---|---|
| `GET` | `/tasteep/stats` | `{"count": 12, "avg_score": 84.7, "distinct_distilleries": 7}` — `avg_score` is `null` when no scored tasting exists |

---

## Regions

`GET /tasteep/regions` → the curated picker, countries in display order, each with its
subregions (empty list when the country is the only sensible choice).

```json
[
  {
    "id": "scotland", "name": "Scotland", "lat": 56.49, "lon": -4.2,
    "subregions": [
      { "id": "scotland/speyside", "name": "Speyside", "lat": 57.45, "lon": -3.15 },
      { "id": "scotland/islay",    "name": "Islay",    "lat": 55.78, "lon": -6.25 }
    ]
  },
  { "id": "sweden", "name": "Sweden", "lat": 62, "lon": 15, "subregions": [] }
]
```

- Ids are stable slugs (`country` or `country/subregion`) — safe to store on the client.
  Any row is a valid `region_id`, a country on its own included.
- `lat`/`lon` are an approximate centroid. **Atlas fallback:** a tasting whose own
  `lat`/`lon` are null but whose `region_id` is set should be drawn at that region's
  centroid (client-side, from this list) — no Nominatim call needed. `location_precision`
  on the tasting is unchanged by this, so such a tasting still comes back from
  `?unplaced=true` and belongs on the NOT PLACED shelf as a *refine* item, like a
  `country`-precision one; only a real `PUT …/location` takes it off the shelf.
- The response carries a weak `ETag`. Send it back as `If-None-Match` to get `304` with no
  body; fetch once per app start and cache.
- The table is edited from the admin dashboard (`/admin/regions`). `src/tasteep/data/region.json`
  only seeds it: at boot, ids the table doesn't have yet are inserted, existing and deleted rows
  are left alone. A deleted region drops out of this list, but tastings that already carry its
  `region_id` keep it, and sending that id back on `PUT` is still accepted.
- Typed `region` text is matched against names and each region's `aliases` (`USA`,
  `Highlands`…); renaming a region in the dashboard keeps the old name as an alias.

---

## SMWS bottles

SMWS bottles sold on smws.eu (single casks, blends and other products such as packs), refreshed nightly. Shared reference
data: every signed-in user gets the same list. A bottle that sells out is never deleted, only
flagged (`available: false`), so the sold-out ones are the archive.

| Method | Path | Response |
|---|---|---|
| `GET` | `/tasteep/smws-bottles` | `{"total", "items": [SmwsBottle]}`: the shop's list, available bottles by default, newest release first |
| `GET` | `/tasteep/smws-bottles/search` | `{"total", "items": [SmwsBottle]}`: every bottle ever seen, best match first; the bottle picker |
| `GET` | `/tasteep/smws-bottles/facets` | `SmwsBottleFacets`: values for the filter sheet |
| `GET` | `/tasteep/smws-bottles/:id` | `SmwsBottle` by cask code (`1.309`) or SKU / `404` |

The list and the search take the same query parameters and differ only in their defaults:

| Query | List default | Search default | Meaning |
|---|---|---|---|
| `q` | | | Free text, see below |
| `status` | `available` | `all` | `available`, `delisted` (sold out) or `all` |
| `kind` | | | `single_cask`, `blend` or `other` |
| `category` | | | distillery code category from `facets` (`single malt`, `rum`, `bourbon`, `gin`…); blends have none |
| `distillery_code` | | | code prefix, e.g. `1`, `G1` (case-insensitive) |
| `region_id` | | | id from `GET /tasteep/regions`; a country also matches its subregions |
| `profile` | | | flavour profile, punctuation and case ignored (`deep rich dried fruits`); `none` = bottles without one |
| `cask` | | | words all found in the cask type (`oloroso`, `1st fill sherry`) |
| `abv_min` / `abv_max` | | | percent |
| `age_min` / `age_max` | | | years (bottles with a stated age only) |
| `price_min` / `price_max` | | | last price seen, EUR |
| `distilled_from` / `distilled_to` | | | year |
| `released_from` / `released_to` | | | year |
| `sort` | `released` | `relevance` with `q`, else `released` | `relevance`, `released`, `abv`, `age`, `price`, `distilled` |
| `order` | `desc` | `desc` | `asc` or `desc`; bottles without the value come last either way |
| `limit` / `offset` | `50` / `0` | `20` / `0` | `limit` ≤ 200 (list) or ≤ 100 (search) |

Malformed values are `400`. Unknown parameters are ignored. `limit=0` returns only `total`
(`items: []`), for counts such as "Show 37 bottles".

**`q`, the free text**, accepts what someone holding a bottle would type:

- **A cask code or its start**: `29.311`, `29.3`, `29.`, `g8.22`, `RW6.5`. Separators `,`,
  `-` and a space work too (`29 311`, `29,311`), since phone keyboards differ. Matches codes
  by prefix, shortest first: `5.1` lists 5.1, then 5.10–5.19, then 5.100…
- **Anything else**: words, each found somewhere in the code, name, batch, distillery,
  region, cask type, profile or age, ignoring case and accents (`menage` finds
  `Ménage à mesquite`). `laphroaig oloroso`, `smoke peat`, `islay 12 years`. Ranking: the
  distillery code itself when the text is one (`29`, `G1`), then names equal to, starting
  with, or containing the text, then distillery names starting with it; newest release
  first within each.

No typo tolerance yet: `lafroaig` finds nothing.

With `status=delisted` and the default sort, the list is ordered by sell-out date
(most recently sold out first).
`GET /tasteep/smws-bottles/:id` → one `SmwsBottle`, where `:id` is a cask code
(`/tasteep/smws-bottles/1.309`) or a SKU; `404` if unknown.

```json
{
  "sku": "001309GX0700614", "kind": "single_cask",
  "code": "1.309", "distillery_code": "1", "cask_no": "309", "batch": null,
  "name": "Barrelbutt", "url": "https://smws.eu/barrelbutt",
  "distillery_name": "Glenfarclas", "category": "single malt",
  "region_text": "Speyside", "region_id": "scotland/speyside",
  "price_text": "€140.00", "price_amount": 140, "price_currency": "EUR",
  "abv": 56.3, "age": "14 years", "cask_type": "1st fill ex-oloroso butt",
  "distilled_date": "2012-01-25",
  "profile": "Dried Fruits & Spices",
  "released_at": "2026-11-06T09:00:00.000Z",
  "available": true, "stock": 45,
  "first_seen_at": "2026-11-09T00:04:12.000Z",
  "last_seen_at": "2026-11-10T00:03:55.000Z",
  "delisted_at": null
}
```

A blend has `kind: "blend"`, `code`/`distillery_code`/`cask_no`/`distillery_name` `null` and
usually `batch` set, the label it is sold under: `"Batch 40"` for Fruit Bomb,
`"Distillery 68 Rare Release"`, `"SM0.001"`. `kind: "other"` covers tasting packs, gift sets,
two-cask duos, gin, rum and beer; it has no `code` either.

- `sku` is the stable id. `code` is unique when set.
- `distillery_code` is the key of `GET /tasteep/smws-codes`; `distillery_name`/`category`
  are `null` for blends and for codes the reference list does not have yet.
- `region_id` is the bottle's region text resolved against the curated regions, falling back
  to the distillery code's region; `null` when neither matches.
- `distilled_date` is `YYYY-MM-DD`; `released_at` is the shop's release date.
- `stock` is the number of bottles left at the last check, when the shop shows it.
- `delisted_at` is when we saw the bottle sell out; `null` for bottles already sold out when
  first seen (most of the archive).
- Every field after `name` and `url` may be `null`.

`GET /tasteep/smws-bottles/facets`, counted over the whole catalog (example values):

```json
{
  "kinds": [{"value": "single_cask", "count": 2224}, {"value": "blend", "count": 95}],
  "categories": [{"value": "single malt", "count": 2068}, {"value": "rum", "count": 27}, …],
  "profiles": [{"value": "Dried Fruits & Spices", "count": 55}, …],
  "abv": {"min": 40.1, "max": 67.9},
  "age": {"min": 1, "max": 40},
  "price": {"min": 45, "max": 3480},
  "distilled_years": {"min": 1982, "max": 2022},
  "released_years": {"min": 2021, "max": 2026},
  "available": 107,
  "delisted": 2212,
  "synced_at": "2026-11-10T09:16:23.298Z"
}
```

`available`/`delisted` count the bottles on sale and sold out. `synced_at` is when the last
successful scrape ended (`null` before the first one): the app's "Synced 6 h ago".

Profile spelling variants are merged under the most common one. Only about 20% of
bottles carry a profile, so a profile filter narrows a lot.

### Your SMWS

`GET /tasteep/smws/me` → the signed-in user's SMWS progress, built from their tastings
linked to a bottle (`smws_sku`):

```json
{
  "linked_casks": 12,
  "linked_tastings": 14,
  "distilleries": {"tasted": 23, "total": 244, "codes": ["3", "4", "29", "33", …]},
  "best": [
    {"bottle": { …SmwsBottle… }, "score": 94, "tasting_id": "…", "date_tasted": "2026-11-02T19:00:00.000Z"}
  ],
  "by_profile": [{"profile": "Bold & Peaty", "avg_score": 91, "count": 4}],
  "by_cask": [{"cask": "oloroso", "avg_score": 90, "count": 3}],
  "untried": {
    "regions": [{"region_id": "scotland/campbeltown", "name": "Campbeltown", "tasted": 0, "total": 3}],
    "categories": [{"category": "rum", "tasted": 0, "total": 14}]
  }
}
```

- `distilleries.total` is every code in `GET /tasteep/smws-codes`; `codes` lists the ones
  tasted, in that list's order.
- `best`: up to 5 bottles, each with its best-scored tasting; highest score first, then the
  most recent.
- `by_profile`: average score per flavour profile (spelling variants merged), best first.
  Unscored tastings and bottles without a profile are left out.
- `by_cask`: the same per cask family. The free-text cask type is folded into one of
  `oloroso`, `px`, `sherry`, `port`, `wine`, `rum`, `virgin_oak` (also heavy-toast and
  numbered-char casks), `bourbon`, `other`; the first that matches wins, so a finish beats
  the bourbon wood it started in.
- `untried.regions`: regions where some codes are still untasted, fewest tasted first (10 at
  most). `untried.categories`: codes-list categories with nothing tasted, largest first.
- Averages have one decimal.

### Adding a tasting from an SMWS bottle

`GET /tasteep/tastings/prefill/:bottle` (`:bottle` = cask code or SKU) →

```json
{
  "tasting": {
    "name": "29.311 Diesel à la crème",
    "category": "whisky",
    "distillery": "Laphroaig",
    "region": "Islay",
    "region_id": "scotland/islay",
    "abv": 58.4,
    "price": 120,
    "age_statement": "10",
    "cask_type": "1st fill US oak ex-oloroso barrel",
    "smws_sku": "029311GX0700612"
  },
  "bottle": { …SmwsBottle… },
  "previous_tastings": [
    {"id": "…", "name": "29.311 Diesel", "date_tasted": "2026-03-10T19:00:00.000Z", "score": 88}
  ]
}
```

- `tasting` holds `Tasting` fields with the same keys: copy them into the new-tasting form
  and leave everything else (date, score, notes, location) to the user. A single cask is
  named `<code> <name>`, as SMWS bottles are known; `age_statement` is the number of years
  (`"14 years"` → `"14"`); `category` comes from the distillery code (`rum` → `rum`, `gin`,
  `cognac`, `armagnac` → `other`) and is `whisky` for blends.
- `price` is the shop's bottle price (EUR); a dram at a bar costs something else, so let
  the user clear it.
- `previous_tastings`: the user's own tastings of this bottle, newest first, for an
  "already tasted, 88" hint.
- `404` if the bottle is unknown.

Suggested flow in the app:

1. The picker calls `/search?q=…` as the user types: debounce ~250 ms, start at 1
   character (a code like `1` or `29` is short), drop responses older than the latest
   request. Show `code` (or `batch`), `name`, `distillery_name`, `age`, `abv` and a sold-out
   badge from `available`; load the next page with `offset` on scroll.
2. On a pick, call `/tasteep/tastings/prefill/:sku` and fill the form.
3. Save with `PUT /tasteep/tastings/:id` as usual, keeping `smws_sku` in the body.
4. Offline or nothing found: the user types freely. Starting the name with the cask code
   still links the bottle when the tasting syncs.

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
5. **Regions.** `Tasting` gains `region_id` (nullable string; add it to `tasting.dart`).
   Fetch `GET /tasteep/regions` once per session for the picker; keep the free-text field
   so the user can still type anything. On the Atlas, draw a tasting with null `lat`/`lon`
   but a `region_id` at that region's centroid.
6. **SMWS bottles.** `Tasting` gains `smws_sku` (nullable string; add it to `tasting.dart`
   and send it back on every PUT). Add the bottle picker and prefill to the new-tasting
   screen; see [Adding a tasting from an SMWS bottle](#adding-a-tasting-from-an-smws-bottle).
