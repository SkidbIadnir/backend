# Alerts API — Frontend Reference

Base URL: `https://api.skidhub.fr`

All endpoints require a `Bearer` JWT obtained from the Discord OAuth flow (`tasteep://callback?token=…`).

---

## Data Models

### `Alert`

```ts
{
  id:         number       // unique alert ID
  name:       string|null  // user-defined label, null if not set
  userId:     string       // Discord user ID (matches the logged-in user)
  guildId:    string|null  // Discord guild ID, legacy — always null for app users
  alertType:  "distillery" | "region" | "age"
  alertValue: string       // see rules below
  isActive:   boolean      // whether the alert is currently active
  matchCount: number       // current count of live SMWS whiskies that match
  createdAt:  string       // ISO 8601 date string
}
```

**`alertValue` rules by type**

| `alertType`   | `alertValue` format | Example |
|---------------|---------------------|---------|
| `distillery`  | SMWS distillery ID  | `"1"`, `"24"`, `"G1"` |
| `region`      | Title Case region name | `"Speyside"`, `"Islay"` |
| `age`         | Integer string (minimum age) | `"12"`, `"18"` |

> The backend normalises `region` to Title Case and `age` to a plain integer string, so always send those in those formats. For `distillery`, send the SMWS ID directly — the app already has the bundled dataset to resolve name → ID.

---

### `Whisky` (returned by the matches endpoint)

```ts
{
  id:              number
  name:            string
  fullCode:        string       // e.g. "1.100"
  distilleryCode:  string|null  // SMWS ID, e.g. "1"
  caskNo:          string|null
  price:           string|null  // e.g. "€85.00"
  abv:             string|null  // e.g. "58.2%"
  age:             string|null  // e.g. "12 years"
  caskType:        string|null
  profile:         string|null
  distillery:      string|null  // human-readable name
  region:          string|null
  available:       boolean
  url:             string|null  // link to SMWS product page
  isNew:           boolean      // true if added within the last 3 days
  newSince:        string|null  // ISO 8601
  createdAt:       string
  updatedAt:       string
}
```

---

## Endpoints

### `GET /alerts`

Returns all alerts for the logged-in user, sorted **active first then inactive**, each enriched with a real-time `matchCount`.

**Response** `200 OK`
```json
[
  {
    "id": 3,
    "name": "My Islay alerts",
    "alertType": "region",
    "alertValue": "Islay",
    "isActive": true,
    "matchCount": 4,
    "createdAt": "2026-05-01T10:00:00.000Z",
    ...
  },
  {
    "id": 1,
    "name": null,
    "alertType": "distillery",
    "alertValue": "24",
    "isActive": false,
    "matchCount": 1,
    ...
  }
]
```

> `matchCount` is computed live on every call. Use the sum of `matchCount` across **active** alerts for the nav badge.

---

### `POST /alerts`

Creates a new alert.

**Request body**
```json
{
  "alertType":  "distillery",
  "alertValue": "24",
  "name":       "My Macallan alert"
}
```
- `name` is optional (omit or send `null` — the app can auto-label from type+value)
- `alertValue` must match the format rules in the table above

**Response** `201 Created` — the created `Alert` object (without `matchCount`)

**Errors**
| Status | Meaning |
|--------|---------|
| `400` | Validation failed (e.g. invalid `alertType`, non-integer age) |
| `409` | You already have an identical alert (same type + value) |

---

### `PATCH /alerts/:id`

Updates one or more fields of an existing alert. Only the fields you include are changed.

**Request body** (all fields optional)
```json
{
  "name":       "New label",
  "isActive":   false,
  "alertType":  "region",
  "alertValue": "Highland"
}
```

**Typical use cases**
- **Toggle on/off**: `{ "isActive": false }`
- **Rename**: `{ "name": "Weekend drams" }`
- **Edit criteria**: `{ "alertType": "age", "alertValue": "18" }`

**Response** `200 OK` — the updated `Alert` object

**Errors**
| Status | Meaning |
|--------|---------|
| `400` | Validation failed |
| `404` | Alert not found or doesn't belong to you |

---

### `DELETE /alerts/:id`

Permanently removes an alert.

**Response** `204 No Content`

**Errors**
| Status | Meaning |
|--------|---------|
| `404` | Alert not found or doesn't belong to you |

---

### `GET /alerts/:id/matches`

Returns the list of currently available SMWS whiskies that match this alert's criteria.

**Response** `200 OK` — array of `Whisky` objects
```json
[
  {
    "id": 42,
    "name": "G1, Cask 1.100 — Bramble jam on warm toast",
    "fullCode": "1.100",
    "distilleryCode": "1",
    "distillery": "Glenfarclas",
    "region": "Speyside",
    "age": "12 years",
    "price": "€85.00",
    "abv": "58.2%",
    "available": true,
    "url": "https://smws.eu/...",
    "isNew": true,
    ...
  }
]
```

Returns `[]` if nothing matches right now.

**Errors**
| Status | Meaning |
|--------|---------|
| `404` | Alert not found or doesn't belong to you |

---

## Auth

Every request must include:
```
Authorization: Bearer <jwt>
```

JWT is obtained from the OAuth deep link `tasteep://callback?token=<jwt>`. It expires after **90 days**. On a `401` response, redirect the user to re-authenticate via `GET /auth/discord`.

---

## Suggested UI → API Mapping

| UI action | API call |
|-----------|----------|
| Load alerts screen | `GET /alerts` |
| Toggle active/inactive | `PATCH /alerts/:id` `{ isActive: bool }` |
| Rename alert | `PATCH /alerts/:id` `{ name: "..." }` |
| Edit criteria (swipe right) | `PATCH /alerts/:id` `{ alertType, alertValue }` |
| Delete (swipe left, confirm) | `DELETE /alerts/:id` |
| Tap alert → see matches | `GET /alerts/:id/matches` |
| Create new alert | `POST /alerts` |
| Nav badge count | sum of `matchCount` where `isActive === true` from `GET /alerts` |
