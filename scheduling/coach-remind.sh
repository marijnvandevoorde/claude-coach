#!/usr/bin/env bash
#
# Claude Coach reminder runner — invoked by cron or launchd.
# Computes today's due reminders and pushes them via `coach notify`.
#
# Usage:  coach-remind.sh [--only=hydration|bedtime] [extra checkin flags]
#
# Configure via environment (e.g. in your crontab or the launchd plist):
#   COACH_NOTIFY_WEBHOOK_URL  your push webhook (e.g. a Home Assistant webhook)
#   COACH_REPO                path to a local claude-coach checkout (dev mode)
#
set -euo pipefail

# cron/launchd start with a minimal PATH — make node/npx discoverable.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# Resolve how to invoke the CLI:
if command -v claude-coach >/dev/null 2>&1; then
  CMD=(claude-coach)                                   # installed globally
elif [[ -n "${COACH_REPO:-}" && -f "$COACH_REPO/dist/cli.js" ]]; then
  CMD=(node "$COACH_REPO/dist/cli.js")                 # local build (run `npm run build`)
elif [[ -n "${COACH_REPO:-}" ]]; then
  CMD=(npx --yes tsx "$COACH_REPO/src/cli.ts")         # local source (dev)
else
  CMD=(npx --yes claude-coach)                         # published package
fi

exec "${CMD[@]}" checkin --notify "$@"
