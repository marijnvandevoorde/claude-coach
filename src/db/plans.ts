/**
 * Persistence for training plans — the single source of truth the web app and
 * the coach MCP both read/write. Stores the full TrainingPlan JSON as one row
 * keyed by meta.id, with at most one row marked active. Style mirrors
 * src/db/garminPush.ts (bare statements + esc()).
 */
import { execute, queryJson } from "./client.js";
import { getDialect } from "./dialect.js";
import type { TrainingPlan } from "../schema/training-plan.js";
import type { PlannedSession } from "../shared/api-types.js";

// Re-export so server modules can keep importing PlannedSession from the plan store.
export type { PlannedSession };

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
  id?: string; // canonical stable id (week1-tue-swim); absent in the flat shape
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

/** Upsert a plan (keyed by meta.id) and make it the active plan. The single write
 *  gate: both `plan save` and `garmin-push`'s auto-register go through here, so a
 *  structurally-dead plan is refused before it can be stored or pushed. The raw
 *  blob is stored verbatim (normalization stays a read-time projection). */
export async function savePlan(plan: TrainingPlan): Promise<void> {
  const v = validatePlan(plan);
  if (!v.ok) throw new Error(`plan rejected:\n- ${v.errors.join("\n- ")}`);
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

function toSession(date: string, w: WorkoutLike, key: string): PlannedSession {
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
    key,
  };
}

const isRealWorkout = (w: WorkoutLike): boolean => {
  const sport = w.sport ?? "";
  return sport !== "" && sport !== "rest";
};

/**
 * Stable per-day-workout identity, used as the Garmin push dedup key AND the app's
 * "✓ on watch" join. Survives renaming a session (its title/name is NOT part of the
 * key), and distinguishes multiple sessions on the same day. Prefers the canonical
 * workout `id`; otherwise keys on date + sport + the workout's ordinal among
 * same-sport sessions that day (so two runs on one day get `…|run#0` / `…|run#1`).
 *
 * A workout that changes DATE still re-keys (moves are a different plan-day) — those
 * orphan the old Garmin workout and want a separate prune pass; renames, which caused
 * the bulk of the duplicate clutter, no longer do.
 */
export function workoutKey(date: string, w: WorkoutLike, sportOrdinal: number): string {
  const id = typeof w.id === "string" ? w.id.trim() : "";
  if (id) return `${date}|${id}`;
  const sport = String(w.sport ?? "run");
  return `${date}|${sport}#${sportOrdinal}`;
}

export interface KeyedWorkout {
  date: string;
  workout: WorkoutLike;
  key: string;
}

/** Every non-rest workout in the plan, each tagged with its stable {@link workoutKey}.
 *  The single source of per-workout keys so the Garmin push side and the app marker
 *  side compute identical ordinals (same-sport index within the day, in array order). */
export function keyedPlanWorkouts(plan: PlanLike): KeyedWorkout[] {
  const out: KeyedWorkout[] = [];
  for (const day of planDays(plan)) {
    const sportCount: Record<string, number> = {};
    for (const w of day.workouts) {
      const sport = String(w.sport ?? "run");
      const ord = sportCount[sport] ?? 0;
      sportCount[sport] = ord + 1; // rest sits in its own bucket → never shifts a real sport's ordinal
      if (!isRealWorkout(w)) continue;
      out.push({ date: day.date, workout: w, key: workoutKey(day.date, w, ord) });
    }
  }
  return out;
}

/** Planned sessions on `date` (rest days dropped). */
export function sessionsForDate(plan: PlanLike, date: string): PlannedSession[] {
  return keyedPlanWorkouts(plan)
    .filter((k) => k.date === date)
    .map((k) => toSession(k.date, k.workout, k.key));
}

/** Upcoming planned sessions from `fromDate` (inclusive), date-sorted, capped. */
export function upcomingWorkouts(plan: PlanLike, fromDate: string, limit = 30): PlannedSession[] {
  const out = keyedPlanWorkouts(plan)
    .filter((k) => k.date >= fromDate)
    .map((k) => toSession(k.date, k.workout, k.key));
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

export interface PlanValidation {
  ok: boolean;
  errors: string[]; // structural failures — reject the plan
  warnings: string[]; // recoverable slop — accept, but surface so the agent can self-correct
  workoutCount: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The write-side contract for a plan. Reuses the same planDays/normalizeWorkout
 * the readers use, so "valid" means exactly "the readers can render it". Rejects
 * only structural death (no id, no dated workouts, nothing to schedule); warns on
 * field slop the normalizer can paper over. Hand-rolled to match the project's
 * no-validation-lib ethos and keep src/schema/training-plan.ts the single source.
 */
export function validatePlan(plan: unknown): PlanValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!plan || typeof plan !== "object") {
    return { ok: false, errors: ["plan is not a JSON object"], warnings, workoutCount: 0 };
  }
  const p = plan as PlanLike & { meta?: { id?: unknown } };
  if (typeof p.meta?.id !== "string" || p.meta.id.trim() === "") {
    errors.push("meta.id is required (a stable plan identifier)");
  }
  const days = planDays(p);
  if (days.length === 0) {
    errors.push(
      "no workout days found — expected weeks[].days[] or a top-level workouts[] with dates"
    );
  }
  let workoutCount = 0;
  for (const day of days) {
    if (!DATE_RE.test(day.date)) {
      errors.push(`invalid day date ${JSON.stringify(day.date)} (want YYYY-MM-DD)`);
    }
    for (const w of day.workouts) {
      if ((w.sport ?? "") === "rest") continue;
      workoutCount++;
      const n = normalizeWorkout(w);
      if (n.durationMinutes == null && n.distanceMeters == null && !n.structure) {
        warnings.push(`${day.date} "${n.name}" has no duration, distance, or structure`);
      }
    }
  }
  if (days.length > 0 && workoutCount === 0) {
    errors.push("plan has no non-rest workouts to schedule");
  }
  return { ok: errors.length === 0, errors, warnings, workoutCount };
}
