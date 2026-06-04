# Claude Coach — MCP reference

Claude Coach can run as a small **remote MCP server** (`coach-mcp`) that exposes the coach to any
Claude client — Desktop, web, mobile, or Claude Code — as `mcp__coach__*` tools. Once the
connector is added, Claude can log your water, fetch Garmin recovery data, push workouts, journal,
and more **without any local install or local `coach.db`**.

Each tool simply execs the corresponding [`claude-coach` CLI](CLI.md) command on the server, so
behavior is identical to the CLI — this page is the tool-by-tool map. For **running and securing**
the server (Docker, OAuth, reverse proxy), see [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Connecting

The server speaks **Streamable HTTP MCP** at `POST /mcp` (with a `/health` check). Add it as a
custom/remote connector in your Claude client, pointing at the server's public URL. Auth options
(set on the server):

- **OAuth (Google-federated)** — recommended for Desktop/web/mobile; the client walks the standard
  OAuth flow. See [`DEPLOYMENT.md`](DEPLOYMENT.md) → Tier 2.
- **Static bearer** — `COACH_AUTH_SECRET`; the client sends `Authorization: Bearer <secret>`.
- **None** — open (only behind a trusted proxy / Cloudflare Access).

When connected, the tools appear as `mcp__coach__<tool>` (e.g. `mcp__coach__wellness`).

---

## Daily wellness & journaling

### `wellness`

Today's hydration + wellness snapshot (water vs goal, sleep, readiness, energy).

- `date` _(string, optional)_ — `YYYY-MM-DD`, default today.

### `log`

Log a wellness/intake value.

- `type` _(required)_ — `water` (ml) · `sleep` (hours) · `energy`/`soreness`/`mood` (1–5) · `weight` (kg)
- `value` _(number, required)_
- `date`, `score` (sleep score), `note` _(optional)_

### `journal`

Add a **free-text** journal entry in the athlete's own words (complements the structured `log`).

- `entry` _(string, required)_ — e.g. "legs heavy, slept badly, stressful week"
- `tag` _(optional)_ — e.g. `race`, `niggle`
- `date` _(optional)_

### `journal_list`

List journal entries, most recent first.

- `since`, `until` _(YYYY-MM-DD)_, `limit` _(number)_ — all optional.

### `summary`

Bundle a period's journal entries + daily wellness/training metrics as JSON so Claude can compose
an end-of-week summary. Defaults to the last 7 days.

- `since`, `to` _(optional)_.

---

## Reminders & notifications

### `config`

Show or update reminder preferences. Pass any field to update; omit all to just read.

- `bedtime`, `wake`, `quiet-start`, `quiet-end` _(HH:MM)_
- `water-goal` _(number)_, `cadence` _(min between hydration nudges)_, `hydration-per-hour` _(number)_
- `notify-webhook` _(URL)_, `notify-channel` _(`auto`/`webhook`/`macos`/`stdout`)_
- `enabled` _(boolean)_ — master on/off switch

### `notify`

Send a push notification via the configured channel (webhook → Home Assistant, macOS, or stdout).

- `message` _(required)_, `title` _(optional)_.

### `checkin`

Assemble today's coaching/reminder payload (plan day + Garmin signals + hydration/recovery). Pass
any Garmin signals you've already fetched, or call `garmin_refresh` first.

- `plan` _(path to a plan JSON on the server)_, `date`
- `readiness`, `sleep-hours`, `sleep-score`, `body-battery`, `resting-hr`, `training-minutes` _(numbers)_
- `hrv-status`, `training-status` _(strings)_

> Scheduling these reminders (cron/launchd) is a host concern — see [`REMINDERS.md`](REMINDERS.md).
> When deployed via Docker, the server already runs the morning fetch + check-in on a schedule.

---

## Garmin

### `garmin_refresh` — the real Garmin pull

Pulls live data **directly from Garmin Connect** on the server (using the saved tokens) and stores
it in `coach.db`: readiness, sleep (+score), HRV (status / weekly avg / baseline + nightly
readings), body battery, resting HR (+7-day avg), VO₂max, steps/distance/floors, intensity
minutes, calories, SpO₂, respiration, training status + ACWR/load, recent activities, and a rich
`garmin_raw` blob. **Use this before a check-in** to get fresh recovery data — it works even when
no `mcp__garmin__*` tools are present in the client.

- `date` _(optional)_.

### `garmin_sync`

Cache Garmin metrics you **already have** into `coach.db`. Does **not** contact Garmin — pass the
values in. (Use `garmin_refresh` to fetch live.)

- `readiness`, `sleep-hours`, `sleep-score`, `body-battery`, `resting-hr`, `training-minutes`,
  `hrv-status`, `training-status`, `date` _(all optional)_.

### `backfill`

Backfill historical Garmin data into `coach.db` over a date range. Cheap range fast-path by
default; `full=true` fetches a per-day complete snapshot. Rate-limited (429 backoff) and resumable
(skips already-complete days unless `force=true`). Safe to run repeatedly / a chunk at a time.

- `from` _(required, YYYY-MM-DD)_, `to` _(default today)_
- `full` _(boolean)_, `force` _(boolean)_.

### `schedule_workouts`

Create + schedule a training plan's workouts directly on Garmin Connect (they sync to the
athlete's watch). Builds each workout, creates it, and schedules it on its date, and links each
pushed workout back to its plan day. Returns an explicit `{pushed, failed, …}` summary (never a
silent no-op).

- Plan source (in order): `plan` _(inline TrainingPlan JSON)_, `file` _(path)_, or **neither →
  the stored active plan** (the usual case).
- `from` / `to` _(YYYY-MM-DD)_ — push only workouts in that window.
- `dryRun` _(boolean)_ — build + return the payloads without pushing anything.

### `upload_route`

Upload a GPX route to Garmin as a course, kept **exactly as-is** (no point reduction, no
snap-to-roads). Provide the GPX one of two ways:

- `gpx` _(string)_ — **inline GPX content** (preferred for a file dropped into the conversation), or
- `file` _(string)_ — a path to a `.gpx` file readable by the server.
- `name` _(default: the GPX track name)_, `type` _(`run`/`trail`/`road`/`mtb`/`gravel`/`cycling`/`hike`/`walk`)_, `dryRun` _(boolean)_.

---

## Plans

The coach persists training plans (one **active** plan at a time). These tools, and the
export/push tools above, default to the active plan when given no `plan`/`file`.

### `save_plan`

Save (create or update) a plan and make it the **active** plan — the one the app shows and
Garmin/calendar push use. Keyed by `meta.id`, so re-saving updates in place.

- `plan` _(required, the full TrainingPlan JSON, inline)_.

### `list_plans` / `get_plan` / `activate_plan` / `delete_plan`

Manage saved plans. `list_plans` (no args) returns id/event/dates/active; `get_plan` _(`id`,
default active)_ returns the full JSON; `activate_plan` _(`id`)_ switches the active plan;
`delete_plan` _(`id`)_ removes one.

### `plan_today` / `plan_upcoming`

`plan_today` _(`date`, default today)_ — the active plan's session(s) for a day (rest dropped).
`plan_upcoming` _(`days`, default 14)_ — upcoming sessions over the next N days.

### `export_calendar`

Turn the plan into a calendar event list (JSON) for pushing to Google Calendar.

- Plan source: `plan` _(inline)_, `file` _(path)_, or **neither → the active plan**.

### `export_garmin`

Turn the plan into structured Garmin workout records (inspect, or feed to `schedule_workouts`).

- Plan source: `plan` _(inline)_, `file` _(path)_, or **neither → the active plan**.

---

## Tool ↔ CLI map

| MCP tool            | CLI command                |
| ------------------- | -------------------------- |
| `wellness`          | `wellness`                 |
| `log`               | `log <type> <value>`       |
| `journal`           | `journal add "<text>"`     |
| `journal_list`      | `journal list`             |
| `summary`           | `summary`                  |
| `config`            | `config`                   |
| `notify`            | `notify <message>`         |
| `checkin`           | `checkin`                  |
| `garmin_refresh`    | `garmin-fetch`             |
| `garmin_sync`       | `garmin-sync`              |
| `backfill`          | `garmin-backfill`          |
| `schedule_workouts` | `garmin-push --active`     |
| `upload_route`      | `garmin-route <file.gpx>`  |
| `save_plan`         | `plan save --stdin`        |
| `list_plans`        | `plan list`                |
| `get_plan`          | `plan get [id]`            |
| `activate_plan`     | `plan activate <id>`       |
| `delete_plan`       | `plan delete <id>`         |
| `plan_today`        | `plan show-today`          |
| `plan_upcoming`     | `plan upcoming`            |
| `export_calendar`   | `export-calendar --active` |
| `export_garmin`     | `export-garmin --active`   |

See [`CLI.md`](CLI.md) for the full flag-by-flag detail of each underlying command.
