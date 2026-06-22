/**
 * Persistence for training goals — the durable, athlete-set race targets the
 * coach plans toward. One row per goal in `training_goals`; multiple are allowed
 * and exactly one resolves as the primary A-race (see {@link getPrimaryGoal}).
 *
 * This is the heart of the "nothing hardcoded" contract: the skill reads the goal
 * from here via MCP, and writes it here when the athlete sets one. No race lives in
 * code. Style mirrors src/db/plans.ts (bare statements + esc()).
 */
import { execute, queryJson } from "./client.js";
import { getDialect } from "./dialect.js";
import { localDate } from "./wellness.js";
import { efd as computeEFD } from "../lib/loadModel.js";

function esc(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function num(value: number | null | undefined): string {
  return value == null || !Number.isFinite(Number(value)) ? "NULL" : String(Number(value));
}

export interface Goal {
  id: string;
  name: string | null;
  event_date: string | null; // 'YYYY-MM-DD'
  event_type: string | null;
  distance_km: number | null;
  elevation_gain_m: number | null;
  terrain: string | null;
  priority: string; // A | B | C
  goal_type: string; // finish | finish-strong | target-time | place
  target_time: string | null; // 'H:MM:SS'
  target_notes: string | null;
  status: string; // active | completed | abandoned
  terrain_notes: string | null;
  notes: string | null;
  gpx_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Fields a caller may set; `id` is derived when absent. */
export type GoalInput = Partial<Omit<Goal, "created_at" | "updated_at">> & { id?: string };

/** Stable, human-readable goal id from the name + event month, e.g.
 *  ("Trail des Hautes Fagnes", "2026-09-13") → "trail-des-hautes-fagnes-2026-09". */
export function slugifyGoalId(name?: string | null, eventDate?: string | null): string {
  const base = String(name ?? "goal")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accent marks
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const ym = typeof eventDate === "string" ? eventDate.slice(0, 7) : "";
  const slug = [base || "goal", ym].filter(Boolean).join("-");
  return slug;
}

const TEXT_COLS = [
  "name",
  "event_date",
  "event_type",
  "terrain",
  "priority",
  "goal_type",
  "target_time",
  "target_notes",
  "status",
  "terrain_notes",
  "notes",
  "gpx_id",
] as const;
const NUM_COLS = ["distance_km", "elevation_gain_m"] as const;

/** Upsert a goal (keyed by id). Returns the id (derived from name+date when absent).
 *  created_at is preserved on re-save; updated_at is bumped. */
export async function saveGoal(input: GoalInput): Promise<string> {
  const id = input.id?.trim() || slugifyGoalId(input.name, input.event_date);
  const dialect = getDialect();
  const g: Record<string, unknown> = {
    name: input.name ?? null,
    event_date: input.event_date ?? null,
    event_type: input.event_type ?? null,
    distance_km: input.distance_km ?? null,
    elevation_gain_m: input.elevation_gain_m ?? null,
    terrain: input.terrain ?? null,
    priority: input.priority ?? "A",
    goal_type: input.goal_type ?? "finish",
    target_time: input.target_time ?? null,
    target_notes: input.target_notes ?? null,
    status: input.status ?? "active",
    terrain_notes: input.terrain_notes ?? null,
    notes: input.notes ?? null,
    gpx_id: input.gpx_id ?? null,
  };
  const cols = ["id", ...TEXT_COLS, ...NUM_COLS, "created_at", "updated_at"];
  const valList = [
    esc(id),
    ...TEXT_COLS.map((c) => esc(g[c] as string | null)),
    ...NUM_COLS.map((c) => num(g[c] as number | null)),
    dialect.now(),
    dialect.now(),
  ];
  // On re-save, overwrite everything except id + created_at.
  const updateCols = [...TEXT_COLS, ...NUM_COLS, "updated_at"];
  await execute(
    dialect.upsert("training_goals", cols, `(${valList.join(", ")})`, "id", updateCols)
  );
  return id;
}

export async function getGoal(id: string): Promise<Goal | null> {
  const rows = await queryJson<Goal>(`SELECT * FROM training_goals WHERE id = ${esc(id)} LIMIT 1;`);
  return rows[0] ?? null;
}

/** All goals, soonest active first. Optionally filter by status. */
export async function listGoals(opts: { status?: string } = {}): Promise<Goal[]> {
  const where = opts.status ? `WHERE status = ${esc(opts.status)}` : "";
  return queryJson<Goal>(
    `SELECT * FROM training_goals ${where}
     ORDER BY (status = 'active') DESC, event_date ASC, created_at ASC;`
  );
}

/**
 * The primary A-race: the single active, priority-A goal with the nearest future
 * event_date (deterministic tie-break on created_at). This is the goal every
 * schedule is built toward. Returns null when none is set — the skill's goal-first
 * guard fires on that.
 */
export async function getPrimaryGoal(fromDate?: string): Promise<Goal | null> {
  const today = localDate(fromDate);
  // Prefer the nearest FUTURE A-race; fall back to the nearest A-race overall
  // (so a just-past race still resolves until the athlete sets the next one).
  const rows = await queryJson<Goal>(
    `SELECT * FROM training_goals
     WHERE status = 'active' AND priority = 'A'
     ORDER BY (event_date >= ${esc(today)}) DESC, event_date ASC, created_at ASC
     LIMIT 1;`
  );
  return rows[0] ?? null;
}

export async function deleteGoal(id: string): Promise<void> {
  await execute(`DELETE FROM training_goals WHERE id = ${esc(id)};`);
}

export async function setGoalStatus(id: string, status: string): Promise<void> {
  await execute(
    `UPDATE training_goals SET status = ${esc(status)}, updated_at = ${getDialect().now()} WHERE id = ${esc(
      id
    )};`
  );
}

// ----------------------------------------------------------------------------
// Pure goal math (cited, unit-tested — no DB). Mirrors src/lib/recovery.ts ethos.
// ----------------------------------------------------------------------------

/** Whole weeks from `fromDate` (default today) to the goal's event date, rounded
 *  up. Null when the goal has no event date. Negative once the race is past. */
export function weeksToGoal(goal: Pick<Goal, "event_date">, fromDate?: string): number | null {
  if (!goal.event_date) return null;
  const from = localDate(fromDate);
  const ms = Date.parse(`${goal.event_date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / (7 * 86_400_000));
}

/**
 * Equivalent Flat Distance (km) for the race — the volume currency trail mode
 * periodizes in (the long run anchors to 70–80% of it). Delegates to the canonical
 * `loadModel.efd` (= distance + (D+/100)·k, default k=1.0 — see trail.md). `k` is
 * the optional technical surcharge. Null when distance is unknown.
 */
export function raceEFD(
  goal: Pick<Goal, "distance_km" | "elevation_gain_m">,
  k = 1.0
): number | null {
  if (goal.distance_km == null || !Number.isFinite(goal.distance_km)) return null;
  return computeEFD(Number(goal.distance_km), Number(goal.elevation_gain_m ?? 0), k);
}

/** Is this a trail/ultra goal (activates EFD/vert trail mode)? Keys off type, then
 *  signals in the text, then any non-trivial vert. */
export function isTrailGoal(goal: Partial<Goal>): boolean {
  const type = String(goal.event_type ?? "").toLowerCase();
  if (/trail|ultra|sky|mountain|fell/.test(type)) return true;
  const text = `${goal.name ?? ""} ${goal.terrain ?? ""} ${goal.notes ?? ""}`.toLowerCase();
  if (/trail|ultra|vert|d\+|elevation|mountain|sky|technical/.test(text)) return true;
  return Number(goal.elevation_gain_m ?? 0) >= 600;
}
