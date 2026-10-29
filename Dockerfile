# syntax=docker/dockerfile:1
#
# Super-lightweight image for the always-on reminder service.
# It runs the Node CLI on a cron schedule: checkin --notify -> your push webhook.
# State lives in the database: MySQL (COACH_DB_DRIVER=mysql) needs no volume at all.
# For SQLite, set COACH_DB_PATH (+ GARMINTOKENS) to a mounted volume (see docker-compose.yml).

# ---------- builder: compile TS -> dist ----------
# Pinned to 26.12.1: Node security release 2026-10-21 (CVE-2026-106069, -106072, -105482, -105483, -111497).
FROM node:26.12.1-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the `prepare`→husky git-hook step (no .git / no husky in CI).
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.config.app.ts ./
COPY src ./src
RUN npx tsc && cp src/db/schema.sql src/db/schema.mysql.sql dist/db/ \
 && npx vite build --config vite.config.app.ts

# ---------- runtime: prod deps + dist only ----------
# Pinned to 26.12.1: Node security release 2026-10-21 (CVE-2026-106069, -106072, -105482, -105483, -111497).
FROM node:26.12.1-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/marijnvandevoorde/claude-coach"
# tzdata = local-time cron. SQLite (if used) is Node's built-in node:sqlite.
# The Garmin fetcher is native TypeScript (src/garmin) — no Python, nothing to pip-install.
RUN apk add --no-cache tzdata
WORKDIR /app
ENV NODE_ENV=production \
    COACH_NOTIFY_CHANNEL=webhook

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY scheduling/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && printf '#!/bin/sh\nexec node /app/dist/cli.js "$@"\n' > /usr/local/bin/coach \
 && chmod +x /usr/local/bin/coach

# No args -> start the reminder cron. With args -> run the CLI (e.g. `docker compose run coach wellness`).
ENTRYPOINT ["docker-entrypoint.sh"]
