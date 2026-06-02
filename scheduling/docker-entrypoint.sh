#!/bin/sh
#
# Entrypoint for the coach reminder container.
#   - with args  -> run the CLI once (e.g. `docker compose run --rm coach wellness --json`)
#   - no args    -> generate a crontab from the environment and run crond in the foreground
#
set -e

# MCP mode (Tier 2): same image, runs the HTTP MCP server instead of the cron.
if [ "$1" = "mcp" ]; then
  if [ -f /app/dist/mcp/server.js ]; then
    exec node /app/dist/mcp/server.js
  fi
  echo "coach: 'mcp' mode requested but the MCP server isn't built yet (see DEPLOYMENT.md - Tier 2)." >&2
  exit 1
fi

# Any other args: run the CLI once (e.g. `docker compose run --rm coach wellness`).
if [ "$#" -gt 0 ]; then
  exec node /app/dist/cli.js "$@"
fi

CRONTAB=/etc/crontabs/root
mkdir -p /etc/crontabs

# Pass the relevant env into the crontab (busybox cron reads NAME=value lines),
# so each job sees COACH_*, GARMINTOKENS and TZ.
printenv | grep -E '^(COACH_|GARMINTOKENS|TZ)=' > "$CRONTAB"

# Schedules are overridable via env; defaults = 07:15 Garmin pull, 07:30 morning,
# hourly hydration 09–21, 22:00 bedtime. The Garmin fetch runs just before the
# morning check-in so readiness/sleep are fresh in coach.db.
cat >> "$CRONTAB" <<EOF
${COACH_GARMIN_FETCH_CRON:-15 7 * * *} node /app/dist/cli.js garmin-fetch >> /proc/1/fd/1 2>&1
${COACH_MORNING_CRON:-30 7 * * *} node /app/dist/cli.js checkin --notify >> /proc/1/fd/1 2>&1
${COACH_HYDRATION_CRON:-0 9-21 * * *} node /app/dist/cli.js checkin --notify --only=hydration >> /proc/1/fd/1 2>&1
${COACH_BEDTIME_CRON:-0 22 * * *} node /app/dist/cli.js checkin --notify --only=bedtime >> /proc/1/fd/1 2>&1
EOF

# Optional: keep the local DB complete by backfilling a rolling window each night.
# Off unless COACH_BACKFILL_CRON is set (e.g. "45 3 * * *"). Range path by default;
# set COACH_BACKFILL_FULL=1 for the per-day complete snapshot. COACH_BACKFILL_DAYS=35.
if [ -n "$COACH_BACKFILL_CRON" ]; then
  echo "$COACH_BACKFILL_CRON node /app/dist/cli.js garmin-backfill --days=${COACH_BACKFILL_DAYS:-35}${COACH_BACKFILL_FULL:+ --full} >> /proc/1/fd/1 2>&1" >> "$CRONTAB"
fi

echo "coach: reminders scheduled (TZ=${TZ:-UTC}); webhook=${COACH_NOTIFY_WEBHOOK_URL:+configured}"
exec crond -f -l 8
