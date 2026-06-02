# syntax=docker/dockerfile:1
#
# Super-lightweight image for the always-on reminder service.
# It runs the Node CLI on a cron schedule: checkin --notify -> your push webhook.
# coach.db + Garmin tokens come from a mounted /data volume (see docker-compose.yml).

# ---------- builder: compile TS -> dist ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the `prepare`→husky git-hook step (no .git / no husky in CI).
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc && cp src/db/schema.sql src/db/schema.mysql.sql dist/db/

# ---------- runtime: prod deps + dist only ----------
FROM node:22-alpine AS runtime
# tzdata = local-time cron; sqlite = CLI fallback if node:sqlite is flagged off.
# The Garmin fetcher is native TypeScript (src/garmin) — no Python, nothing to pip-install.
RUN apk add --no-cache tzdata sqlite
WORKDIR /app
ENV NODE_ENV=production \
    COACH_DB_PATH=/data/coach.db \
    GARMINTOKENS=/data/garminconnect \
    COACH_NOTIFY_CHANNEL=webhook

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY scheduling/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && printf '#!/bin/sh\nexec node /app/dist/cli.js "$@"\n' > /usr/local/bin/coach \
 && chmod +x /usr/local/bin/coach

VOLUME ["/data"]
# No args -> start the reminder cron. With args -> run the CLI (e.g. `docker compose run coach wellness`).
ENTRYPOINT ["docker-entrypoint.sh"]
