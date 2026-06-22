/**
 * Activity-side persistence for the plan-vs-actual reconcile: load actual
 * activities in a date window, and attach the athlete's note + the adherence
 * verdict to a specific activity. The note (coach_notes) is distinct from
 * Strava's `description` — it's the answer to a reconcile question and the
 * label that reclassifies a session. Style mirrors src/db/plans.ts.
 */
import { execute, queryJson } from "./client.js";
import type { ActualActivity } from "../lib/planActual.js";

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
