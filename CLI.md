# Claude Coach — CLI reference

Everything Claude Coach can do is a CLI command. The skill, the cron reminders, and the
[MCP server](MCP.md) all drive this same `claude-coach` binary, so anything below works the
same whether you type it yourself or Claude runs it for you.

> **Looking for the MCP equivalents?** Every command here has a matching tool on the remote
> coach server — see [`MCP.md`](MCP.md). For scheduling reminders with cron/launchd, see
> [`REMINDERS.md`](REMINDERS.md).

## Running the CLI

```bash
npx claude-coach <command> [options]      # installed package
```

From a **source checkout**, run `npm run build` once so `claude-coach` / `npx claude-coach`
resolve the compiled `dist/`. Until you build, use the dev runner:

```bash
npm start -- <command> [options]          # e.g. npm start -- wellness
```

### Where your data lives

State is kept in a local SQLite database at `~/.claude-coach/coach.db` (activities, wellness,
hydration, journal, reminder prefs, cached Garmin metrics). Useful environment variables:

| Variable            | Purpose                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| `COACH_DB_PATH`     | Override the SQLite file location                                           |
| `COACH_DB_DRIVER`   | `sqlite` (default) or `mysql`                                               |
| `COACH_DB_URL`      | MySQL connection string (`mysql://user:pass@host:3306/coach`) when on MySQL |
| `GARMINTOKENS`      | Path to the saved Garmin OAuth tokens (dir or `garmin_tokens.json`)         |
| `COACH_DATA_SOURCE` | Wearable data source — `garmin` (default)                                   |

On Node 22.5+ the built-in `node:sqlite` is used; older Node falls back to the `sqlite3` CLI.
For MySQL, set `COACH_DB_DRIVER=mysql` plus `COACH_DB_URL` (or the discrete `COACH_DB_HOST` /
`COACH_DB_PORT` / `COACH_DB_USER` / `COACH_DB_PASSWORD` / `COACH_DB_NAME` vars).

---

## Logging wellness & water intake

`log <type> <value>` records a subjective or intake data point for today (or `--date=`). It
feeds the daily check-in and the weekly summary.

```bash
npx claude-coach log water 500          # ml of water (a glass ≈ 250 ml)
npx claude-coach log sleep 7.5 --score=82   # hours slept (+ optional Garmin sleep score)
npx claude-coach log energy 4           # subjective energy 1–5
npx claude-coach log soreness 3         # soreness 1–5
npx claude-coach log mood 4             # mood 1–5
npx claude-coach log weight 72.5        # body weight in kg
```

| Type       | Value       | Notes                               |
| ---------- | ----------- | ----------------------------------- |
| `water`    | millilitres | accumulates toward the daily goal   |
| `sleep`    | hours       | add `--score=` for the Garmin score |
| `energy`   | 1–5         | subjective                          |
| `soreness` | 1–5         | subjective                          |
| `mood`     | 1–5         | subjective                          |
| `weight`   | kg          |                                     |

Common flags: `--date=YYYY-MM-DD` (default today), `--note="…"`, and for water `--source=`.

### See today's snapshot

```bash
npx claude-coach wellness               # hydration vs goal + sleep/readiness/energy
npx claude-coach wellness --date=2026-06-01 --json
```

---

## Journaling & the weekly summary

Where `log` captures structured numbers, **journaling captures free text** — the athlete's own
words ("legs heavy, stressful week", "great tempo, felt strong"). At the end of a week,
`summary` bundles those entries together with the week's wellness/training metrics so Claude can
read it back to you.

```bash
# Add an entry (defaults to today)
npx claude-coach journal add "legs heavy on the climb, work stress" --tag=note
npx claude-coach journal add "raced a local 10k, PB!" --tag=race --date=2026-05-30

# List entries, newest first
npx claude-coach journal list --since=2026-05-26
npx claude-coach journal list --since=2026-05-01 --until=2026-05-31 --limit=50 --json

# Bundle the week (journal + wellness) as JSON for a written summary
npx claude-coach summary --since=2026-05-26
npx claude-coach summary --since=2026-05-26 --to=2026-06-01
```

`summary` defaults to the last 7 days and emits JSON (`{ since, until, journal, wellness }`) —
it's a data provider; Claude composes the prose. `journal` flags: `--tag=`, `--date=`;
`journal list` flags: `--since=`, `--until=`, `--limit=`, `--json`.

---

## Configuring reminders

`config` shows or updates your reminder preferences (stored in `coach.db`). Pass any subset of
flags to update; run it with no flags to print the current settings.

```bash
npx claude-coach config \
  --water-goal=3000 \        # daily hydration target (ml)
  --cadence=60 \             # min between hydration nudges
  --hydration-per-hour=500 \ # extra ml added per training hour
  --wake=06:45 --bedtime=22:00 \
  --quiet-start=22:00 --quiet-end=07:00 \
  --enable                   # (or --disable) master switch
```

| Flag                     | Meaning                                       |
| ------------------------ | --------------------------------------------- |
| `--water-goal=N`         | Daily hydration goal in ml                    |
| `--cadence=N`            | Minutes between hydration nudges (default 60) |
| `--hydration-per-hour=N` | Extra ml added to the goal per training hour  |
| `--wake=HH:MM`           | Wake target                                   |
| `--bedtime=HH:MM`        | Bedtime target (drives the wind-down nudge)   |
| `--quiet-start=HH:MM`    | Start of quiet hours (suppresses non-bedtime) |
| `--quiet-end=HH:MM`      | End of quiet hours                            |
| `--notify-webhook=URL`   | Push webhook (see below)                      |
| `--notify-channel=…`     | `auto` / `webhook` / `macos` / `stdout`       |
| `--enable` / `--disable` | Turn reminders on/off                         |

### Push notifications

```bash
# Point at your Home Assistant (or any) webhook — stored locally in coach.db
npx claude-coach config --notify-webhook=https://homeassistant.local/api/webhook/your-id

# Send one now
npx claude-coach notify "Time to hydrate 💧"
npx claude-coach notify "test" --channel=stdout   # prints, never pushes
```

The `notify` channel picks the best available: **webhook** (POSTs `{title, message}` JSON →
great with Home Assistant), **macOS** banner, or **stdout** fallback. Override per call with
`--channel=` / `--url=`, or the `COACH_NOTIFY_WEBHOOK_URL` / `COACH_NOTIFY_CHANNEL` env vars.

### The daily check-in

`checkin` assembles today's plan day + cached Garmin signals + hydration/recovery state into one
coaching payload. It's the engine behind the scheduled reminders.

```bash
npx claude-coach checkin --json                       # full payload for an agent
npx claude-coach checkin --notify                      # send everything due (for cron)
npx claude-coach checkin --notify --only=hydration     # just hydration, if behind pace
npx claude-coach checkin --notify --only=bedtime       # bedtime wind-down
npx claude-coach checkin --greeting                    # one-line context for a SessionStart hook
```

Dedup is automatic (hydration respects the cadence window, bedtime fires once per night, quiet
hours suppress non-bedtime nudges). **To actually schedule these with cron or launchd, see
[`REMINDERS.md`](REMINDERS.md).**

---

## Garmin: recovery data, history, workouts & routes

The coach talks to Garmin Connect directly with a native TypeScript client using the OAuth tokens
in `$GARMINTOKENS` — **no separate Garmin MCP needed.** Mint the tokens once (valid ~6 months):

```bash
GARMIN_EMAIL="you@example.com" GARMIN_PASSWORD="your-password" \
  uvx --python 3.12 --from git+https://github.com/Taxuspt/garmin_mcp garmin-mcp-auth
```

### Pull today's recovery data

```bash
npx claude-coach garmin-fetch                     # last night's readiness/sleep/HRV/load + daily metrics
npx claude-coach garmin-fetch --date=2026-06-01 --json
```

Caches readiness, sleep (+score), HRV (status / weekly avg / baseline + nightly readings), body
battery, resting HR (+7-day avg), VO₂max, steps/distance/floors, intensity minutes, calories,
SpO₂, respiration, training status + ACWR/load, recent activities, and a rich `garmin_raw` blob —
all into `coach.db`. (For a machine that already has the numbers from elsewhere, `garmin-sync`
caches values you pass in without contacting Garmin.)

### Backfill history

`garmin-fetch` keeps _today_ current; `garmin-backfill` fills in the **past** — rate-limited
(429 backoff) and **resumable** (skips days already complete unless `--force`).

```bash
# Cheap range fast-path (steps/distance/floors/stress/RHR/intensity/body-battery/HRV)
npx claude-coach garmin-backfill --from=2026-01-01 --to=2026-06-01

# Per-day COMPLETE snapshot (adds sleep, training load, VO₂max, calories, SpO₂, respiration, garmin_raw)
npx claude-coach garmin-backfill --from=2026-05-01 --full
npx claude-coach garmin-backfill --days=35 --full        # last 35 days, complete
npx claude-coach garmin-backfill --days=35 --full --force # re-fetch even already-complete days
```

| Flag       | Meaning                                                   |
| ---------- | --------------------------------------------------------- |
| `--from=`  | Start date (YYYY-MM-DD)                                   |
| `--to=`    | End date (default today)                                  |
| `--days=N` | Convenience: last N days (alternative to `--from`)        |
| `--full`   | Per-day complete snapshot instead of the cheap range path |
| `--force`  | Re-fetch days that already have a full snapshot           |

Run one big historical `--full` by hand, then let a nightly job keep recent days complete (set
`COACH_BACKFILL_CRON` in the container — see [`REMINDERS.md`](REMINDERS.md) and `.env.example`).

### Per-activity detail: GPS tracks + splits/HR streams

The activity-detail view (map, per-split pace, heart-rate line) reads **stored** per-activity data —
never a live fetch. `garmin-fetch` already pulls streams for each newly-ingested activity; these two
commands backfill history. Both are resumable (skip activities already populated unless `--force`)
and throttled (429 backoff).

```bash
npx claude-coach garmin-tracks               # GPS polyline per activity (map + course-from-activity)
npx claude-coach garmin-streams              # real splits + downsampled HR stream per activity
npx claude-coach garmin-streams --limit=200  # most-recent 200 only
npx claude-coach garmin-streams --id=1234567 # a single activity
```

| Flag         | Meaning                                         |
| ------------ | ----------------------------------------------- |
| `--limit=N`  | Only the N most-recent activities               |
| `--id=`      | A single activity id                            |
| `--force`    | Re-fetch even activities that already have data |
| `--delay-ms` | Throttle between calls (default 600)            |

(`garmin-fetch --no-streams` skips the per-activity stream pull for a fast wellness-only refresh.)

### Push workouts to the watch

Turn a plan's sessions into structured workouts **created and scheduled** on Garmin Connect (they
sync to the watch). This is native — no `mcp__garmin__*` server required. The plan comes from the
stored **active plan** (`--active`), a file, or `--stdin`.

```bash
npx claude-coach garmin-push --active --dry-run    # preview the active plan's payloads, push nothing
npx claude-coach garmin-push --active              # create + schedule on each workout's date
npx claude-coach garmin-push --active --from=2026-06-08 --to=2026-06-14   # just one week
npx claude-coach garmin-push plan.json             # or push a specific file
```

Re-running is idempotent: an existing same-name workout for that date is updated in place rather
than duplicated, and each pushed workout is linked back to its plan day. An empty/all-rest window
returns an explicit `{pushed:0, reason}` rather than failing silently. (`export-garmin --active`
just emits the structured-workout feed as JSON without pushing — useful for inspection.)

### Upload a route/course

```bash
npx claude-coach garmin-route route.gpx --name="Sunday loop" --type=trail
npx claude-coach garmin-route route.gpx --type=mtb --dry-run
```

The GPX is uploaded **exactly as-is** — no point reduction, no snap-to-roads. Course types:
`run`, `trail`, `road`, `mtb`, `gravel`, `cycling`, `hike`, `walk`. (The MCP variant also accepts
inline GPX content piped via `--stdin`.)

---

## Strava: activity history

```bash
# 1. Generate an auth URL (credentials from strava.com/settings/api)
npx claude-coach auth --client-id=12345 --client-secret=abc123
# 2. Open the URL, authorize, copy the entire redirect URL back
npx claude-coach auth --code="FULL_REDIRECT_URL"
# 3. Sync activity history (default 730 days)
npx claude-coach sync --days=730
npx claude-coach sync                  # later: incremental refresh with cached tokens
```

---

## Plans: store, render & export

The coach persists training plans (one **active** at a time); the app and Garmin/calendar push
read the active plan.

```bash
cat plan.json | npx claude-coach plan save --stdin   # save (or update) + make active
npx claude-coach plan list                           # id / event / dates / which is active
npx claude-coach plan get [id]                       # full JSON (default: the active plan)
npx claude-coach plan activate <id>                  # switch the active plan
npx claude-coach plan delete <id>                    # remove a plan
npx claude-coach plan show-today                     # the active plan's session(s) today
npx claude-coach plan upcoming --days=14             # upcoming sessions

npx claude-coach render plan.json --output plan.html # interactive HTML viewer
npx claude-coach export-calendar --active            # → .ics file (or a file path)
npx claude-coach export-calendar --active --json     # → event list for the Google Calendar MCP
npx claude-coach export-garmin --active              # → structured-workout JSON (see garmin-push)
```

---

## Querying the database

```bash
npx claude-coach query "SELECT * FROM weekly_volume LIMIT 5"
npx claude-coach query "SELECT * FROM recent_activities" --json
```

Handy views/tables: `activities`, `athlete`, `goals`, `wellness_state`, `hydration_log`,
`journal`, `weekly_volume`, `recent_activities`, `hydration_daily`.

---

## Command summary

| Command                                  | What it does                                           |
| ---------------------------------------- | ------------------------------------------------------ |
| `log <type> <val>`                       | Log water/sleep/energy/soreness/mood/weight            |
| `wellness`                               | Today's hydration + wellness snapshot                  |
| `journal add "<text>"`                   | Add a free-text journal entry                          |
| `journal list`                           | List journal entries                                   |
| `summary`                                | Bundle the week's journal + wellness as JSON           |
| `config`                                 | Show/set reminder preferences                          |
| `notify <message>`                       | Send a push notification                               |
| `checkin`                                | Assemble plan + Garmin + wellness; send due reminders  |
| `garmin-fetch`                           | Pull today's live data from Garmin into `coach.db`     |
| `garmin-sync`                            | Cache Garmin metrics you already have                  |
| `garmin-backfill`                        | Backfill historical Garmin data (range or `--full`)    |
| `garmin-push --active`                   | Create + schedule the active plan's workouts on Garmin |
| `garmin-route <file.gpx>`                | Upload a GPX as a Garmin course                        |
| `plan save\|list\|get\|activate\|delete` | Manage stored plans (one active at a time)             |
| `plan show-today\|upcoming`              | Active plan's sessions today / upcoming                |
| `sync` / `auth`                          | Strava activity history                                |
| `render <plan>`                          | Render a plan JSON to an HTML viewer                   |
| `export-calendar --active`               | Plan → `.ics` / calendar events                        |
| `export-garmin --active`                 | Plan → structured-workout JSON                         |
| `query <sql>`                            | Run a SQL query against the database                   |
| `help`                                   | Full built-in help                                     |
