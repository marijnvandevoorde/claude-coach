/**
 * Activity-side persistence for the plan-vs-actual reconcile: load actual
 * activities in a date window, and attach the athlete's note + the adherence
 * verdict to a specific activity. The note (coach_notes) is distinct from
 * Strava's `description` — it's the answer to a reconcile question and the
 * label that reclassifies a session. Style mirrors src/db/plans.ts.
 */
import { execute, queryJson } from "./client.js";
import { getDialect } from "./dialect.js";
import type { ActualActivity } from "../lib/planActual.js";
import type { StravaActivity } from "../strava/types.js";

function esc(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Actual activities (run family included) in [from, to], localized to the date
 *  part of start_date, in the shape the reconcile consumes. */
export async function loadActuals(from: string, to: string): Promise<ActualActivity[]> {
  const rows = await queryJson<{
    id: number;
    start_date: string | null;
    sport_type: string | null;
    moving_time: number | null;
    distance: number | null;
    total_elevation_gain: number | null;
    average_heartrate: number | null;
    max_heartrate: number | null;
    average_watts: number | null;
  }>(
    `SELECT id, start_date, sport_type, moving_time, distance, total_elevation_gain,
            average_heartrate, max_heartrate, average_watts
     FROM activities
     WHERE start_date >= ${esc(from)} AND start_date <= ${esc(`${to}T23:59:59Z`)}
     ORDER BY start_date ASC;`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    date: String(r.start_date ?? "").slice(0, 10),
    sport: r.sport_type ?? "",
    movingMin: (Number(r.moving_time) || 0) / 60,
    distanceKm: (Number(r.distance) || 0) / 1000,
    dPlusM: Number(r.total_elevation_gain) || 0,
    avgHr: r.average_heartrate ?? null,
    maxHr: r.max_heartrate ?? null,
    avgWatts: r.average_watts ?? null,
  }));
}

/** Attach (or replace) the coach/athlete note on an activity. */
export async function setActivityNote(id: number, note: string): Promise<void> {
  await execute(`UPDATE activities SET coach_notes = ${esc(note)} WHERE id = ${Number(id)};`);
}

/** Store the adherence verdict JSON for an activity (overwrites). */
export async function setActivityAdherence(id: number, verdictJson: string): Promise<void> {
  await execute(
    `UPDATE activities SET adherence_json = ${esc(verdictJson)} WHERE id = ${Number(id)};`
  );
}

export interface ActivityNoteRow {
  id: number;
  coach_notes: string | null;
  adherence_json: string | null;
}

/** Read back the note + adherence for an activity (for the app / a re-check). */
export async function getActivityNote(id: number): Promise<ActivityNoteRow | null> {
  const rows = await queryJson<ActivityNoteRow>(
    `SELECT id, coach_notes, adherence_json FROM activities WHERE id = ${Number(id)} LIMIT 1;`
  );
  return rows[0] ?? null;
}

function sqlNum(value: unknown): string {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? "NULL" : String(n);
}

/** Store a Garmin activity summary. Upsert, not REPLACE: REPLACE deletes the row
 *  first, which wiped the stored GPS track, streams, coach notes and adherence
 *  verdict on every fetch (and made garmin-fetch re-download every recent
 *  activity's track + streams each time). */
export async function saveGarminActivity(a: Record<string, unknown>): Promise<void> {
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const cols = [
    "id",
    "name",
    "sport_type",
    "start_date",
    "elapsed_time",
    "moving_time",
    "distance",
    "total_elevation_gain",
    "average_speed",
    "max_speed",
    "average_heartrate",
    "max_heartrate",
    "average_cadence",
    "calories",
    "raw_json",
    "synced_at",
  ];
  const dialect = getDialect();
  await execute(
    dialect.upsert(
      "activities",
      cols,
      `(
       ${sqlNum(a.id)}, ${esc(str(a.name))}, ${esc(str(a.sport_type))},
       ${esc(str(a.start_date))}, ${sqlNum(a.elapsed_time)}, ${sqlNum(a.moving_time)},
       ${sqlNum(a.distance)}, ${sqlNum(a.total_elevation_gain)}, ${sqlNum(a.average_speed)},
       ${sqlNum(a.max_speed)}, ${sqlNum(a.average_heartrate)}, ${sqlNum(a.max_heartrate)},
       ${sqlNum(a.average_cadence)}, ${sqlNum(a.calories)},
       ${esc(JSON.stringify(a.raw ?? a))}, ${dialect.now()}
     )`,
      "id",
      cols.filter((c) => c !== "id")
    )
  );
}

/** Store a Strava activity. Upsert, not REPLACE, for the same reason as
 *  saveGarminActivity: keep the stored track, streams, notes and adherence. */
export async function saveStravaActivity(activity: StravaActivity): Promise<void> {
  const cols = [
    "id",
    "name",
    "sport_type",
    "start_date",
    "elapsed_time",
    "moving_time",
    "distance",
    "total_elevation_gain",
    "average_speed",
    "max_speed",
    "average_heartrate",
    "max_heartrate",
    "average_watts",
    "max_watts",
    "weighted_average_watts",
    "kilojoules",
    "suffer_score",
    "average_cadence",
    "calories",
    "description",
    "workout_type",
    "gear_id",
    "raw_json",
    "synced_at",
  ];
  const a = activity;
  const dialect = getDialect();
  const values = [
    sqlNum(a.id),
    esc(a.name),
    esc(a.sport_type),
    esc(a.start_date),
    sqlNum(a.elapsed_time),
    sqlNum(a.moving_time),
    sqlNum(a.distance),
    sqlNum(a.total_elevation_gain),
    sqlNum(a.average_speed),
    sqlNum(a.max_speed),
    sqlNum(a.average_heartrate),
    sqlNum(a.max_heartrate),
    sqlNum(a.average_watts),
    sqlNum(a.max_watts),
    sqlNum(a.weighted_average_watts),
    sqlNum(a.kilojoules),
    sqlNum(a.suffer_score),
    sqlNum(a.average_cadence),
    sqlNum(a.calories),
    esc(a.description),
    sqlNum(a.workout_type),
    esc(a.gear_id),
    esc(JSON.stringify(a)),
    dialect.now(),
  ];
  await execute(
    dialect.upsert(
      "activities",
      cols,
      `(${values.join(", ")})`,
      "id",
      cols.filter((c) => c !== "id")
    )
  );
}
