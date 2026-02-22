# Backend Platform

Personal backend platform for multiple projects and services. The first implemented project is the SMWS Watchtower module.

## Current scope

- Hosts modular backend services under one codebase
- Includes SMWS Watchtower as the first production module
- Persists project data in PostgreSQL
- Exposes operational HTTP endpoints per module
- Supports Discord-based automation and notifications

## Implemented module: SMWS Watchtower

- **Live + archive scraper** using Playwright
- **PostgreSQL storage** for SMWS watchtower tables
- **Discord bot integration** with slash commands:
  - `/alert-add`
  - `/alert-list`
  - `/alert-remove`
- **Alert matching** by distillery, region, or minimum age
- **Scheduled jobs**:
  - Live scraper: daily at midnight
  - Archive scraper: every 2 days at 01:00

## Platform direction

- This backend is intentionally structured to grow with additional modules
- Future projects can add their own controllers/services while reusing shared infrastructure
- The SMWS Watchtower endpoints and commands below describe only the current module set

## Requirements

- Node.js 18+
- PostgreSQL 14+
- A Discord bot token

## Environment setup

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Required variables:

- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DISCORD_BOT_TOKEN`

## Installation & rune

```bash
npm install
```

### Development

```bash
npm run start:dev
```

### Production

```bash
npm run build
npm run start:prod
```

## First-time initialization

After the app starts, initialize/check DB tables and distillery seed data:

```bash
curl http://localhost:3000/postgres/tables
```

## API endpoints

The following endpoints are currently provided by the SMWS Watchtower implementation.

### App

- `GET /` - basic health/message endpoint

### Scraper

- `GET /scraper/run-live` - run live scraper now
- `GET /scraper/run-archive` - run archive scraper now
- `GET /scraper/test-alerts` - test alert matching against existing DB rows

### PostgreSQL

- `GET /postgres/tables` - ensure required tables exist and distilleries are populated
- `DELETE /postgres/tables/purge` - purge SMWS data tables (destructive)

### Watchtower

- `GET /watchtower/live` - read live watchtower entries

## Discord commands

- `/alert-add type:distillery value:Ardbeg`
- `/alert-add type:region value:Islay`
- `/alert-add type:age value:15`
- `/alert-list`
- `/alert-remove id:5`

## Testing

```bash
npm run test
npm run test:e2e
npm run test:cov
```

## Useful docs in this repo

- [ALERTS_DOCUMENTATION.md](./ALERTS_DOCUMENTATION.md)
- [QUICK_START.md](./QUICK_START.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
