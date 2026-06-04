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

/**
 * Minimal plan shape we walk. Tolerant of the two shapes coaching plans come in:
 *  1. canonical TrainingPlan — `weeks[].days[].workouts[]` (day carries the date), and
 *  2. a flatter shape some plans use — a top-level `workouts[]` where each workout
 *     carries its own `date`.
 * Workout fields also have aliases (LLM-authored plans aren't always canonical):
 * name/title, durationMinutes/durationMin, distanceMeters/distanceKm, primaryZone/intensity.
 */
interface WorkoutLike {
  date?: string; // present in the flat top-level workouts[] shape
  sport?: string;
  type?: string;
  name?: string;
  title?: string; // alias for name
  durationMinutes?: number;
  durationMin?: number; // alias
  distanceMeters?: number;
  distanceKm?: number; // alias
  primaryZone?: string;
  intensity?: string; // alias
  description?: string;
  humanReadable?: string;
  // canonical-only fields, passed through for Garmin push
  targetHR?: { low: number; high: number };
  targetPace?: { low: string; high: string };
  targetPower?: { low: number; high: number };
  rpe?: number;
  structure?: unknown;
}
interface PlanLike {
  weeks?: Array<{
    weekNumber?: number;
    phase?: string;
    isRecoveryWeek?: boolean;
    days?: Array<{ date: string; dayOfWeek?: string; workouts?: WorkoutLike[] }>;
  }>;
  workouts?: WorkoutLike[]; // flat shape: each workout carries its own date
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
  // Backfill missing start/end (some plans leave meta dates blank) from the actual
  // workout dates so the list/table metadata is correct.
  const range = planDateRange(plan);
  const startDate = m.planStartDate || range.start;
  const endDate = m.planEndDate || range.end;
  const eventDate = m.eventDate || endDate;
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
    `(${esc(m.id)}, ${esc(m.athlete)}, ${esc(m.event)}, ${esc(eventDate)}, ` +
    `${esc(startDate)}, ${esc(endDate)}, 1, ${esc(json)}, ${dialect.now()}, ${dialect.now()})`;
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

/** Canonical workout fields (aliases resolved), for both the app and Garmin push. */
export interface NormalizedWorkout {
  sport: string;
  type?: string;
  name: string;
  durationMinutes?: number;
  distanceMeters?: number;
  primaryZone?: string;
  description?: string;
  humanReadable?: string;
  targetHR?: { low: number; high: number };
  targetPace?: { low: string; high: string };
  targetPower?: { low: number; high: number };
  rpe?: number;
  structure?: unknown;
}

/** Resolve a (possibly non-canonical) workout's field aliases. */
export function normalizeWorkout(w: WorkoutLike): NormalizedWorkout {
  return {
    sport: String(w.sport ?? "run"),
    type: w.type,
    name: w.name ?? w.title ?? "Workout",
    durationMinutes: w.durationMinutes ?? w.durationMin,
    distanceMeters:
      w.distanceMeters ??
      (typeof w.distanceKm === "number" ? Math.round(w.distanceKm * 1000) : undefined),
    primaryZone: w.primaryZone ?? w.intensity,
    description: w.description,
    humanReadable: w.humanReadable,
    targetHR: w.targetHR,
    targetPace: w.targetPace,
    targetPower: w.targetPower,
    rpe: w.rpe,
    structure: w.structure,
  };
}

/** Flatten a plan into per-day entries regardless of shape: canonical
 *  `weeks[].days[]`, or a flat top-level `workouts[]` grouped by each workout's date. */
export function planDays(plan: PlanLike): PlanDay[] {
  const out: PlanDay[] = [];
  if (plan.weeks?.length) {
    for (const week of plan.weeks) {
      for (const day of week.days ?? []) {
        out.push({
          date: day.date,
          dayOfWeek: day.dayOfWeek,
          weekNumber: week.weekNumber,
          phase: week.phase,
          isRecoveryWeek: week.isRecoveryWeek,
          workouts: day.workouts ?? [],
        });
      }
    }
  } else if (plan.workouts?.length) {
    const byDate = new Map<string, WorkoutLike[]>();
    for (const w of plan.workouts) {
      if (!w?.date) continue;
      (byDate.get(w.date) ?? byDate.set(w.date, []).get(w.date)!).push(w);
    }
    for (const [date, workouts] of byDate) out.push({ date, workouts });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** The plan day matching `date` (exact YYYY-MM-DD), or null. */
export function deriveTodaysWorkout(plan: PlanLike, date: string): PlanDay | null {
  return planDays(plan).find((d) => d.date === date) ?? null;
}

function toSession(date: string, w: WorkoutLike): PlannedSession {
  const n = normalizeWorkout(w);
  return {
    date,
    sport: n.sport,
    type: n.type,
    name: n.name,
    durationMinutes: n.durationMinutes,
    distanceMeters: n.distanceMeters,
    primaryZone: n.primaryZone,
    description: n.description ?? n.humanReadable,
  };
}

const isRealWorkout = (w: WorkoutLike): boolean => {
  const sport = w.sport ?? "";
  return sport !== "" && sport !== "rest";
};

/** Planned sessions on `date` (rest days dropped). */
export function sessionsForDate(plan: PlanLike, date: string): PlannedSession[] {
  const day = deriveTodaysWorkout(plan, date);
  if (!day) return [];
  return day.workouts.filter(isRealWorkout).map((w) => toSession(date, w));
}

/** Upcoming planned sessions from `fromDate` (inclusive), date-sorted, capped. */
export function upcomingWorkouts(plan: PlanLike, fromDate: string, limit = 30): PlannedSession[] {
  const out: PlannedSession[] = [];
  for (const day of planDays(plan)) {
    if (day.date < fromDate) continue;
    for (const w of day.workouts) if (isRealWorkout(w)) out.push(toSession(day.date, w));
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out.slice(0, limit);
}

/** First/last workout dates across the plan (for backfilling missing meta dates). */
export function planDateRange(plan: PlanLike): { start: string | null; end: string | null } {
  const days = planDays(plan);
  return days.length
    ? { start: days[0].date, end: days[days.length - 1].date }
    : { start: null, end: null };
}
