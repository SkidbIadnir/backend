# ── Build stage: full toolchain, dev dependencies, compile, then drop dev deps ──
FROM node:20-bookworm AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# ── Runtime stage ───────────────────────────────────────────────────────────────
# Debian slim (glibc), not Alpine: sharp ships prebuilt glibc binaries.
FROM node:20-bookworm-slim

WORKDIR /app

# Safe default: TypeORM `synchronize` stays off unless the environment sets
# NODE_ENV to something else (dev does, through its Coolify variables).
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Pre-migration schema scripts (history) and the ad hoc SQL runner:
#   node scripts/db/apply-sql.mjs some.sql [--yes]
# Migrations ship in dist/database/migrations and run when the app boots.
COPY --from=build /app/scripts/db ./scripts/db

# Tasting photos. Mount a persistent volume here, otherwise uploads are lost
# when the container is replaced. The process runs as root for now: the
# existing Coolify photo volumes are owned by root.
ENV TASTEEP_PHOTOS_DIR=/data/photos
RUN mkdir -p /data/photos

EXPOSE 3000

# GET /health runs `SELECT 1`: unhealthy when the app or its database is down.
# The slim image has no curl, so Node's own fetch does the request.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/main"]
