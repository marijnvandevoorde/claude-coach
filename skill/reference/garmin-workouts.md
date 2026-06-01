# Pushing Workouts to Garmin (and your watch)

When the athlete wants their plan as **structured workouts on their Garmin device** (e.g. a Fenix), create the workouts in Garmin Connect **and schedule them** — Garmin syncs _scheduled_ workouts to the paired watch. Requires the `mcp__garmin__*` tools.

## Steps

1. **Get the workouts** from the plan:

   ```bash
   npx claude-coach export-garmin <plan>.json
   ```

   → per non-rest workout: `{ date, sport, type, name, durationMinutes, primaryZone, targetHR, targetPace, targetPower, structure, humanReadable }`.

2. **Create each workout in Garmin Connect** with the matching builder (each uploads on creation):
   - Run / walk intervals → `mcp__garmin__create_walk_run_workout` (use `structure` / `humanReadable` for the steps, `targetHR` / `targetPace` for targets).
   - Easy steady aerobic → `mcp__garmin__create_z2_walk_workout` (or a steady run via the walk/run builder).
   - Strength → `mcp__garmin__create_strength_workout`.
   - **Bike / swim:** the current builders are run/walk/strength-focused. If there's no matching builder, tell the athlete those sessions stay on the calendar/plan only (or create them manually in Garmin) — don't silently skip them.

3. **Schedule them on their dates → this is what syncs to the watch.** Collect the created workouts and call `mcp__garmin__schedule_week` with the list (each item = the workout + its `date`). Scheduling is what makes Garmin Connect push the session to the Fenix on its day.

4. **Stay idempotent.** Don't double-create: when re-running after a plan change, check existing scheduled workouts for those dates and replace rather than stack.

5. **Confirm:** "Created and scheduled N workouts on Garmin (<start> → <end>) — they'll appear on your watch on the next sync."

## Mapping notes

- **Intensity:** prefer `targetHR` / `targetPace` / `targetPower` when present; otherwise fall back to `primaryZone` (e.g. "Z2", "Threshold"), which the builders resolve to Garmin zones.
- **Duration / structure:** `durationMinutes` for steady sessions; `structure` (or parse `humanReadable`) for intervals.
- Complementary to the calendar export (`calendar.md`): the **calendar** says _when_, **Garmin** puts the _executable workout_ on the wrist.
