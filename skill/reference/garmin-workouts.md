# Pushing Workouts to Garmin (and your watch)

When the athlete wants their plan as **structured workouts on their Garmin device** (e.g. a
Fenix), the coach creates the workouts in Garmin Connect **and schedules them** — Garmin syncs
_scheduled_ workouts to the paired watch. **The coach does this natively** (using the saved Garmin
tokens) — no `mcp__garmin__*` server required.

## Preferred path — native coach push

One step builds, creates, and schedules every workout on its date. It operates on the **stored
active plan** (`--active`) — so once the plan is saved (`save_plan`), pushing needs no JSON:

```bash
npx claude-coach garmin-push --active --dry-run    # preview the active plan's payloads, push nothing
npx claude-coach garmin-push --active              # create + schedule on Garmin → syncs to the watch
npx claude-coach garmin-push --active --from=2026-06-08 --to=2026-06-14   # just one week
```

On the **coach MCP connector** (Desktop / mobile / web), use the equivalent tool:

- `mcp__coach__schedule_workouts` — **no args pushes the active plan** (add `dryRun: true` to
  preview, or `from`/`to` for a window). You can still pass `plan` (inline JSON) or `file` to push
  a specific one.

What it does:

- Builds Garmin's structured-workout DTO from each non-rest session (sport, end condition by
  time/distance, interval/repeat groups, and HR / pace / power targets resolved from the plan's
  zones).
- Creates each workout, then **schedules it on its date** — scheduling is what makes Garmin push
  the session to the wrist on its day.
- **Idempotent:** re-running after a plan change updates the same workout in place (keyed on a
  rename-stable plan-day identity, so re-wording "3×8" → "2×12" updates rather than duplicates).
- **Prunes orphans:** a full push (no `from`/`to` window) deletes any previously-pushed workout for
  the plan that's no longer in it, so dropped/renamed sessions don't linger on the watch. A
  **windowed** push (`--from`/`--to`) never prunes; pass `--no-prune` to opt out entirely.
- **Links each pushed workout back to its plan day**, so the web app marks that session "✓ on
  watch". An empty/all-rest window returns an explicit `{pushed:0, reason}` (never a silent no-op).

Confirm to the athlete: "Created and scheduled N workouts on Garmin (`<start>` → `<end>`) — they'll
appear on your watch on the next sync."

### Inspecting first (optional)

`npx claude-coach export-garmin <plan>.json` (or `mcp__coach__export_garmin`) emits the
structured-workout feed as JSON without pushing — handy to review the mapping before a real push.

## Uploading a route/course

To put a **course** on the watch (e.g. for a long trail session or a race recon), upload a GPX —
kept **exactly as-is**, no point reduction or snap-to-roads:

```bash
npx claude-coach garmin-route <route>.gpx --name="Sunday loop" --type=trail
```

- MCP: `mcp__coach__upload_route` — pass inline GPX content as `gpx` (e.g. a file dropped into the
  conversation) **or** a server-readable `file` path, plus optional `name` / `type` / `dryRun`.
- Course types: `run`, `trail`, `road`, `mtb`, `gravel`, `cycling`, `hike`, `walk`.

## Mapping notes

- **Intensity:** targets come from the plan — HR (bpm), power (`percent_ftp` × FTP → watts), and
  pace (`targetPace` → m/s). Steps without a resolvable target are left open.
- **Duration / structure:** time- or distance-based end conditions; interval sets become Garmin
  repeat groups (warmup / work / recovery / rest / cooldown step types). **This only happens if the
  workout carries a `structure` object** (see "Structured workouts" in `SKILL.md`). A session with
  intervals described only in `humanReadable`/`description` text but no `structure` collapses to a
  **single step** on the watch (e.g. "3 × 8 min" → one flat 14 km block). Author `structure` for
  every multi-effort session, and verify with `--dry-run` that it emits a `RepeatGroupDTO`.
- **Bike / swim:** structured push currently covers run/walk-style steps best. If a session can't
  be expressed as structured steps, tell the athlete it stays on the calendar/plan only (or create
  it manually in Garmin) — don't silently skip it.
- Complementary to the calendar export (`calendar.md`): the **calendar** says _when_, **Garmin**
  puts the _executable workout_ on the wrist.

## Fallback — the standalone Garmin MCP

If the native push can't express a session you need (e.g. a specialized bike/swim builder), and a
local Claude Code session has the optional `mcp__garmin__*` server connected, you can still use its
`create_*` / `schedule_week` tools. This is now a **fallback**, not the default — prefer
`garmin-push` / `mcp__coach__schedule_workouts`.
