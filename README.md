# SMWS Watchtower Backend

Personal backend platform built with NestJS. The first production module is **SMWS Watchtower** — a whisky alert system that scrapes the Society's live inventory and notifies users via Discord bot and Firebase push notifications when bottles matching their preferences appear.

## Features

- Live and archive scraper using Playwright (headless Firefox) against the SMWS website
- Alert matching by distillery, region, or minimum age
- Discord bot with slash commands for managing alerts
- Firebase Cloud Messaging push notifications for mobile/web clients
- REST API with Discord OAuth2 and JWT authentication
- PostgreSQL storage via TypeORM
- Scheduled jobs (live scraper daily at midnight, archive every 2 days at 01:00)
- Docker-ready with CI/CD via GitHub Actions

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 / TypeScript 5 |
| Database | PostgreSQL 14+ / TypeORM |
| Discord | discord.js 14 |
| Scraping | Playwright 1.57 (Firefox) |
| Auth | Discord OAuth2, Passport JWT |
| Push notifications | Firebase Admin SDK |
| Scheduling | @nestjs/schedule (cron) |
| Runtime | Node.js 20 |
| Container | Docker (node:20-bookworm) |

## Architecture

```
Discord User
    │  slash commands (/alert-add, /alert-list, /alert-remove)
    ▼
Discord Bot (discord.js)
    │  stores / reads alerts
    ▼
PostgreSQL  ◄──────────────────────────────────────────────┐
    │  active alerts                                        │
    ▼                                                       │
Scraper (Playwright)  ──► SMWS Website (smws.eu)           │
    │  new whiskies                                         │
    ▼                                                       │
Alert Matching  ─────────────────── smws_live table ───────┘
    │  matched whiskies
    ▼
Notifications Service
    ├── Firebase FCM push → mobile/web clients
    └── (Discord DM — dormant, planned)
```

### Modules

| Module | Responsibility |
|---|---|
| `alerts` | CRUD for user alerts + matching logic |
| `auth` | Discord OAuth2 flow, JWT generation, device token storage |
| `discord` | Bot init, slash command registration, channel messaging |
| `scraper` | Playwright scraper, scheduled jobs, alert triggering |
| `watchtower` | Read-only access to live whisky inventory |
| `notifications` | Alert matching pipeline + FCM push dispatch |
| `postgres` | Legacy direct-query layer, table init, distillery seed |

## Prerequisites

- Node.js 20+
- PostgreSQL 14+
- A Discord application with a bot token and OAuth2 credentials
- (Optional) Firebase project for push notifications

## Setup

```bash
git clone <repo>
cd backend
npm install
cp .env.example .env
# fill in .env values — see table below
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_HOST` | Yes | Database host |
| `POSTGRES_PORT` | Yes | Database port (default `5432`) |
| `POSTGRES_DB` | Yes | Database name |
| `POSTGRES_USER` | Yes | Database user |
| `POSTGRES_PASSWORD` | Yes | Database password |
| `DISCORD_BOT_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | OAuth2 client ID |
| `DISCORD_CLIENT_SECRET` | Yes | OAuth2 client secret |
| `APP_URL` | Yes | Public base URL of this API (e.g. `https://api.example.com`) |
| `JWT_SECRET` | Yes | Secret used to sign JWT tokens |
| `FIREBASE_PROJECT_ID` | No | Firebase project ID (push notifications) |
| `FIREBASE_CLIENT_EMAIL` | No | Firebase service account email |
| `FIREBASE_PRIVATE_KEY` | No | Firebase service account private key (`\n`-escaped) |

### First-time Database Init

After the app starts, seed the distillery reference data and ensure all tables exist:

```bash
curl http://localhost:3000/postgres/tables
```

## Running the App

```bash
# Development (watch mode)
npm run start:dev

# Production
npm run build
npm run start:prod
```

## Docker

```bash
docker build -t smws-backend .
docker run -p 3000:3000 --env-file .env smws-backend
```

The CI/CD pipeline (`.github/workflows/ci-cd.yml`) builds and pushes the image to `ghcr.io` on every push.

## API Reference

All alert and auth endpoints require a `Authorization: Bearer <jwt>` header unless noted.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | No | Health check |
| `GET` | `/auth/discord` | No | Redirect to Discord OAuth flow |
| `GET` | `/auth/callback` | No | Discord OAuth callback, returns JWT |
| `POST` | `/auth/device-token` | Yes | Register FCM device token for push notifications |
| `GET` | `/alerts` | Yes | List user's alerts with live match counts |
| `POST` | `/alerts` | Yes | Create a new alert |
| `PATCH` | `/alerts/:id` | Yes | Update alert (name, criteria, active status) |
| `DELETE` | `/alerts/:id` | Yes | Delete an alert |
| `GET` | `/alerts/:id/matches` | Yes | Whiskies currently matching this alert |
| `GET` | `/watchtower/live` | Yes | Live whisky inventory |
| `GET` | `/scraper/run-live` | No | Trigger live scraper immediately |
| `GET` | `/scraper/run-archive` | No | Trigger archive scraper immediately |
| `GET` | `/postgres/tables` | No | Check/init tables and seed distilleries |
| `DELETE` | `/postgres/tables/purge` | No | Purge all SMWS data tables (destructive) |

Full REST API schema: [docs/alerts-api.md](./docs/alerts-api.md)

## Discord Bot Commands

| Command | Parameters | Description |
|---|---|---|
| `/alert-add` | `type: distillery\|region\|age`, `value: <string>` | Create an alert |
| `/alert-list` | — | List your active alerts |
| `/alert-remove` | `id: <number>` | Remove an alert by ID |

**Alert type examples:**

```
/alert-add type:distillery value:Ardbeg
/alert-add type:region value:Islay
/alert-add type:age value:15
```

## Scheduled Jobs

| Job | Schedule | Manual trigger |
|---|---|---|
| Live scraper | Daily at midnight | `GET /scraper/run-live` |
| Archive scraper | Every 2 days at 01:00 | `GET /scraper/run-archive` |

The live scraper compares the fetched inventory against the existing DB and marks new rows with `is_new = true`, then runs the alert-matching pipeline.

## Development

```bash
# Unit tests
npm run test

# Test coverage
npm run test:cov

# E2E tests
npm run test:e2e

# Lint
npm run lint

# Format
npm run format
```
