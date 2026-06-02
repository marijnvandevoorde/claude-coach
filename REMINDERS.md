# Proactive reminders & scheduling

Claude Coach can send you proactive wellness nudges — **morning check-in**, **daytime hydration**, and an **evening bedtime** wind-down — as push notifications. The logic is deterministic and lives in the CLI, so a plain cron/launchd job is all you need; no always-on daemon.

How it fits together:

- `coach checkin` computes what's due right now from `coach.db` (your reminder prefs, hydration log, cached Garmin/wellness state) and today's plan.
- `coach checkin --notify` delivers the due, non-suppressed reminders through `coach notify` (webhook → Home Assistant, macOS, or stdout — see the README's "Push notifications").
- A scheduler (cron or launchd) runs that command at the right times.

## 1. One-time setup

> **Running from a source checkout?** Run `npm run build` once so `claude-coach` / `npx claude-coach` resolve the compiled `dist/`. Otherwise use `npm start -- <command>` (the dev runner). The `coach-remind.sh` wrapper already handles both.

```bash
# Goals + windows (24h local time)
npx claude-coach config \
  --water-goal=3000 --cadence=60 \
  --wake=06:45 --bedtime=22:00 \
  --quiet-start=22:00 --quiet-end=07:00 \
  --enable

# Push channel — point at your Home Assistant webhook (stored locally in coach.db)
npx claude-coach config --notify-webhook=https://homeassistant.local/api/webhook/your-id
# (or leave it unset and provide COACH_NOTIFY_WEBHOOK_URL in the scheduler env)
```

Verify delivery without waiting for cron:

```bash
npx claude-coach notify "test" --channel=stdout   # prints, never pushes
npx claude-coach checkin --notify --channel=webhook
```

## 2. What fires when

| Time (local)           | Command                                   | Sends                                                                      |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| **07:30**              | `coach checkin --notify`                  | recovery flag (if readiness/sleep poor) + hydration kickoff                |
| **hourly 09:00–21:00** | `coach checkin --notify --only=hydration` | hydration nudge **only if** behind pace (respects `water_cadence_minutes`) |
| **22:00**              | `coach checkin --notify --only=bedtime`   | bedtime wind-down (once per night)                                         |

Dedup is automatic: hydration won't repeat within the cadence window, bedtime fires at most once per local day, and **quiet hours** suppress non-bedtime nudges. So even if a job runs more often than needed, you won't get spammed.

## 3. Schedule with cron (Linux / macOS)

A wrapper (`scheduling/coach-remind.sh`) fixes the minimal cron `PATH` and locates the CLI. Make it executable and add crontab entries:

```bash
chmod +x scheduling/coach-remind.sh
crontab -e
```

```cron
# --- Claude Coach reminders ---
COACH_NOTIFY_WEBHOOK_URL=https://homeassistant.local/api/webhook/your-id
COACH_REPO=/Users/you/Sites/marijnvandevoorde/claude-coach

30 7   * * *  /Users/you/Sites/marijnvandevoorde/claude-coach/scheduling/coach-remind.sh
0  9-21 * * *  /Users/you/Sites/marijnvandevoorde/claude-coach/scheduling/coach-remind.sh --only=hydration
0  22  * * *  /Users/you/Sites/marijnvandevoorde/claude-coach/scheduling/coach-remind.sh --only=bedtime
```

> On a laptop, cron skips jobs scheduled while the machine is asleep. On macOS, prefer **launchd** (below), which re-fires missed runs on wake.

## 4. Schedule with launchd (macOS, recommended)

Use the example agent and clone it per job:

```bash
cp scheduling/com.claude-coach.morning.plist ~/Library/LaunchAgents/
#   edit the CHANGE_ME paths + webhook inside it
launchctl load ~/Library/LaunchAgents/com.claude-coach.morning.plist
```

Clone it for bedtime (`Hour 22`, add `--only=bedtime` to `ProgramArguments`) and hydration (`Minute 0` only → hourly, `--only=hydration`).

## 5. Daily Garmin fetch (keeps the DB complete)

The `garmin-fetch` command pulls **last night's** readiness/sleep/HRV/load + the full daily metric set straight from Garmin (native TypeScript client, using your `$GARMINTOKENS`) and caches it in `coach.db` — no Claude agent or Garmin MCP needed. The container runs it at **07:15**, just before the 07:30 check-in, so the morning nudge is recovery-aware:

```cron
15 7 * * * /path/to/coach-remind.sh garmin-fetch       # local CLI equivalent
```

(Local launchd users: clone the morning plist with `garmin-fetch` as the argument and an earlier time.) Then the 07:30 `checkin --notify` reads the fresh data from `coach.db`.

### Slowly backfill history

`garmin-fetch` keeps _today_ current; to fill in the **past**, use `garmin-backfill` (rate-limited, resumable):

```bash
coach garmin-backfill --from=2026-01-01 --to=2026-06-01   # range fast-path (cheap)
coach garmin-backfill --days=35 --full                    # last 35 days, complete per-day
```

In the container, set `COACH_BACKFILL_CRON` (e.g. `45 3 * * *`) to backfill a rolling window each night (`COACH_BACKFILL_DAYS`, default 35; `COACH_BACKFILL_FULL=1` for per-day). Run a big historical `--full` once by hand; the nightly job then keeps recent days complete.

## Reminder design (framing)

The cadence and tone borrow from [`ClutchEngineering/coach-claude`](https://github.com/ClutchEngineering/coach-claude): brief, non-nagging nudges, not lectures.

- **Don't nag.** Each reminder type self-dedups — hydration only re-fires after `water_cadence_minutes` (default **60**), bedtime at most **once per local night**. Running a job more often than needed is harmless.
- **Pace, not panic.** Hydration nudges only when you're meaningfully behind the day's pro-rated goal (≥250 ml), so you're not pinged when you're on track.
- **Hydrate before bed.** The bedtime nudge (fires within ~90 min of your target) reminds you to drink water before winding down.
- **Respect the day.** Quiet hours suppress non-bedtime nudges; reminders honor your `--enable`/`--disable` switch.
- **Load-aware.** The hydration goal grows with the day's training (`+hydration_per_active_hour_ml` per training hour).

> Movement/stretch nudges during an active coding session are a separate, in-session feature (a later sprint), not part of this cron backbone.

## Ambient nudges in Claude Code (SessionStart hook)

To have Claude gently surface anything overdue at the **start of a Claude Code session**, add a `SessionStart` hook that runs `checkin --greeting` — it prints one line of context when something's due (water behind, near/past bedtime, low readiness) and **nothing** otherwise. In `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "npx claude-coach checkin --greeting" }] }
    ]
  }
}
```

The line is injected as session context, so Claude can weave it in naturally — and, for low readiness, adjust today's session (see `skill/reference/adaptive.md`). From a source checkout, point it at your build the same way as the cron jobs.
