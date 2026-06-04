/**
 * Persistence for training plans — the single source of truth the web app and
 * the coach MCP both read/write. Stores the full TrainingPlan JSON as one row
 * keyed by meta.id, with at most one row marked active. Style mirrors
 * src/db/garminPush.ts (bare statements + esc()).
 */
import { execute, queryJson } from "./client.js";
import { getDialect } from "./dialect.js";
import type { TrainingPlan } from "../schema/training-plan.js";

function esc(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Minimal plan shape we walk. A saved TrainingPlan satisfies it, and so does
 *  the looser JSON the CLI parses from a file/stdin. */
interface WorkoutLike {
  sport?: string;
  type?: string;
  name?: string;
  durationMinutes?: number;
  distanceMeters?: number;
  primaryZone?: string;
  description?: string;
  humanReadable?: string;
}
interface PlanLike {
  weeks?: Array<{
    weekNumber?: number;
    phase?: string;
    isRecoveryWeek?: boolean;
    days?: Array<{ date: string; dayOfWeek?: string; workouts?: WorkoutLike[] }>;
  }>;
}

/** Plan list-row metadata (no blob). */
export interface PlanSummary {
  id: string;
  athlete: string | null;
  event: string | null;
  event_date: string | null;
  start_date: string | null;
  end_date: string | null;
  active: number;
  updated_at: string | null;
}

/** A day matched out of a plan (the shape `checkin` consumes). */
export interface PlanDay {
  date: string;
  dayOfWeek?: string;
  weekNumber?: number;
  phase?: string;
  isRecoveryWeek?: boolean;
  workouts: WorkoutLike[];
}

/** One planned session, flattened for the app (rest days dropped). */
export interface PlannedSession {
  date: string;
  sport: string;
  type?: string;
  name: string;
  durationMinutes?: number;
  distanceMeters?: number;
  primaryZone?: string;
  description?: string;
  syncedToGarmin?: boolean;
}

/** Upsert a plan (keyed by meta.id) and make it the active plan. */
export async function savePlan(plan: TrainingPlan): Promise<void> {
  const dialect = getDialect();
  const m = plan.meta;
  const json = JSON.stringify(plan);
  const cols = [
    "id",
    "athlete",
    "event",
    "event_date",
    "start_date",
    "end_date",
    "active",
    "plan_json",
    "created_at",
    "updated_at",
  ];
  const vals =
    `(${esc(m.id)}, ${esc(m.athlete)}, ${esc(m.event)}, ${esc(m.eventDate)}, ` +
    `${esc(m.planStartDate)}, ${esc(m.planEndDate)}, 1, ${esc(json)}, ${dialect.now()}, ${dialect.now()})`;
  // created_at stays put on re-save; active is set explicitly via setActivePlan.
  await execute(
    dialect.upsert("training_plans", cols, vals, "id", [
      "athlete",
      "event",
      "event_date",
      "start_date",
      "end_date",
      "plan_json",
      "updated_at",
    ])
  );
  await setActivePlan(m.id);
}

/** Make `id` the only active plan. Procedural — MySQL has no portable partial
 *  unique index, so clear all then set one. */
export async function setActivePlan(id: string): Promise<void> {
  await execute(`UPDATE training_plans SET active = 0 WHERE active = 1;`);
  await execute(`UPDATE training_plans SET active = 1 WHERE id = ${esc(id)};`);
}

export async function deletePlan(id: string): Promise<void> {
  await execute(`DELETE FROM training_plans WHERE id = ${esc(id)};`);
}

export async function getActivePlan(): Promise<TrainingPlan | null> {
  const rows = await queryJson<{ plan_json: string }>(
    `SELECT plan_json FROM training_plans WHERE active = 1 LIMIT 1;`
  );
  return rows[0] ? (JSON.parse(rows[0].plan_json) as TrainingPlan) : null;
}

export async function getPlan(id: string): Promise<TrainingPlan | null> {
  const rows = await queryJson<{ plan_json: string }>(
    `SELECT plan_json FROM training_plans WHERE id = ${esc(id)} LIMIT 1;`
  );
  return rows[0] ? (JSON.parse(rows[0].plan_json) as TrainingPlan) : null;
}

export async function listPlans(): Promise<PlanSummary[]> {
  return queryJson<PlanSummary>(
    `SELECT id, athlete, event, event_date, start_date, end_date, active, updated_at
     FROM training_plans ORDER BY active DESC, updated_at DESC;`
  );
}

/** The plan day matching `date` (exact YYYY-MM-DD), or null. */
export function deriveTodaysWorkout(plan: PlanLike, date: string): PlanDay | null {
  for (const week of plan.weeks ?? []) {
    for (const day of week.days ?? []) {
      if (day.date === date) {
        return {
          date,
          dayOfWeek: day.dayOfWeek,
          weekNumber: week.weekNumber,
          phase: week.phase,
          isRecoveryWeek: week.isRecoveryWeek,
          workouts: day.workouts ?? [],
        };
      }
    }
  }
  return null;
}

function toSession(date: string, w: WorkoutLike): PlannedSession {
  return {
    date,
    sport: String(w.sport),
    type: w.type,
    name: w.name ?? "Workout",
    durationMinutes: w.durationMinutes,
    distanceMeters: w.distanceMeters,
    primaryZone: w.primaryZone,
    description: w.description ?? w.humanReadable,
  };
}

/** Planned sessions on `date` (rest days dropped). */
export function sessionsForDate(plan: PlanLike, date: string): PlannedSession[] {
  const day = deriveTodaysWorkout(plan, date);
  if (!day) return [];
  return day.workouts.filter((w) => w?.sport && w.sport !== "rest").map((w) => toSession(date, w));
}

/** Upcoming planned sessions from `fromDate` (inclusive), date-sorted, capped. */
export function upcomingWorkouts(plan: PlanLike, fromDate: string, limit = 30): PlannedSession[] {
  const out: PlannedSession[] = [];
  for (const week of plan.weeks ?? []) {
    for (const day of week.days ?? []) {
      if (day.date < fromDate) continue;
      for (const w of day.workouts ?? []) {
        if (w?.sport && w.sport !== "rest") out.push(toSession(day.date, w));
      }
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out.slice(0, limit);
}
