/**
 * Persistence for pushed Garmin workouts, so re-pushing a plan updates each
 * workout in place (by stored workoutId) instead of creating duplicates.
 * Backs the `garmin-push` CLI command; implements the PushStore interface that
 * src/garmin/workouts.ts expects (keeping that module DB-agnostic).
 */
import { execute, queryJson } from "./client.js";

function esc(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}
function num(value: number | null | undefined): string {
  return value == null || !Number.isFinite(Number(value)) ? "NULL" : String(Number(value));
}

export interface PushedWorkout {
  push_key: string;
  workout_id: number;
  schedule_id: number | null;
  name: string | null;
  date: string | null;
}

export function lookupPushedWorkout(key: string): PushedWorkout | undefined {
  return queryJson<PushedWorkout>(
    `SELECT push_key, workout_id, schedule_id, name, date
     FROM garmin_pushed_workouts WHERE push_key = ${esc(key)};`
  )[0];
}

export function savePushedWorkout(p: PushedWorkout): void {
  execute(
    `INSERT INTO garmin_pushed_workouts (push_key, workout_id, schedule_id, name, date, updated_at)
     VALUES (${esc(p.push_key)}, ${num(p.workout_id)}, ${num(p.schedule_id)}, ${esc(p.name)}, ${esc(p.date)}, datetime('now'))
     ON CONFLICT(push_key) DO UPDATE SET
       workout_id = excluded.workout_id,
       schedule_id = excluded.schedule_id,
       name = excluded.name,
       date = excluded.date,
       updated_at = datetime('now');`
  );
}
