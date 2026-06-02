import { execute, queryJson } from "./client.js";

// ============================================================================
// Wellness & reminder state access
//
// Backs the `log`, `config`, and `checkin` CLI commands. All wellness data
// lives in coach.db (tables: reminder_prefs, hydration_log, wellness_state)
// so both Claude Code cron agents and in-session nudges share one source.
// ============================================================================

function esc(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

/** Athlete-local date as YYYY-MM-DD (defaults to today in the host timezone). */
export function localDate(date?: string): string {
  if (date) return date;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ----------------------------------------------------------------------------
// Reminder preferences (single row, id = 1)
// ----------------------------------------------------------------------------

export interface ReminderPrefs {
  id: number;
  bedtime_target: string | null;
  wake_target: string | null;
  hydration_goal_ml: number;
  water_cadence_minutes: number;
  hydration_per_active_hour_ml: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
  reminders_enabled: number;
  notify_channel: string;
  notify_webhook_url: string | null;
  updated_at: string | null;
}

export function getPrefs(): ReminderPrefs {
  const rows = queryJson<ReminderPrefs>("SELECT * FROM reminder_prefs WHERE id = 1;");
  if (rows.length > 0) return rows[0];
  // Schema seeds this row, but be defensive if it's somehow missing.
  execute("INSERT OR IGNORE INTO reminder_prefs (id) VALUES (1);");
  return queryJson<ReminderPrefs>("SELECT * FROM reminder_prefs WHERE id = 1;")[0];
}

export type PrefsPatch = Partial<{
  bedtime_target: string | null;
  wake_target: string | null;
  hydration_goal_ml: number;
  water_cadence_minutes: number;
  hydration_per_active_hour_ml: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
  reminders_enabled: number;
  notify_channel: string;
  notify_webhook_url: string | null;
}>;

const PREFS_TEXT_COLS = new Set([
  "bedtime_target",
  "wake_target",
  "quiet_hours_start",
  "quiet_hours_end",
  "timezone",
  "notify_channel",
  "notify_webhook_url",
]);

export function updatePrefs(patch: PrefsPatch): void {
  const sets: string[] = [];
  for (const [col, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (PREFS_TEXT_COLS.has(col)) {
      sets.push(`${col} = ${esc(value as string | null)}`);
    } else {
      sets.push(`${col} = ${value === null ? "NULL" : Number(value)}`);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  execute(`UPDATE reminder_prefs SET ${sets.join(", ")} WHERE id = 1;`);
}

// ----------------------------------------------------------------------------
// Hydration log
// ----------------------------------------------------------------------------

export function logHydration(
  amountMl: number,
  opts: { date?: string; source?: string; note?: string } = {}
): void {
  const date = localDate(opts.date);
  execute(
    `INSERT INTO hydration_log (logged_at, local_date, amount_ml, source, note)
     VALUES (datetime('now'), ${esc(date)}, ${Math.round(amountMl)}, ${esc(
       opts.source ?? "manual"
     )}, ${esc(opts.note)});`
  );
}

/** Total ml logged for a given local date. */
export function hydrationTotal(date?: string): number {
  const d = localDate(date);
  const rows = queryJson<{ total_ml: number | null }>(
    `SELECT COALESCE(SUM(amount_ml), 0) AS total_ml FROM hydration_log WHERE local_date = ${esc(
      d
    )};`
  );
  return Number(rows[0]?.total_ml ?? 0);
}

// ----------------------------------------------------------------------------
// Daily wellness snapshot (one row per local_date)
// ----------------------------------------------------------------------------

export interface WellnessRow {
  local_date: string;
  sleep_hours: number | null;
  sleep_score: number | null;
  subjective_energy: number | null;
  soreness: number | null;
  mood: number | null;
  weight_kg: number | null;
  notes: string | null;
  readiness_score: number | null;
  body_battery_morning: number | null;
  resting_hr: number | null;
  hrv_status: string | null;
  training_status: string | null;
  training_minutes: number | null;
  hrv_weekly_avg: number | null;
  hrv_baseline_low: number | null;
  hrv_baseline_upper: number | null;
  avg_stress: number | null;
  acwr: number | null;
  acute_load: number | null;
  chronic_load: number | null;
  vo2max: number | null;
  total_steps: number | null;
  total_distance_m: number | null;
  floors_climbed: number | null;
  intensity_min_moderate: number | null;
  intensity_min_vigorous: number | null;
  active_calories: number | null;
  total_calories: number | null;
  avg_spo2: number | null;
  avg_waking_respiration: number | null;
  rhr_7day_avg: number | null;
  body_battery_charged: number | null;
  garmin_raw: string | null;
  last_water_reminder_at: string | null;
  last_bedtime_reminder_at: string | null;
  updated_at: string | null;
}

export type WellnessPatch = Partial<Omit<WellnessRow, "local_date" | "updated_at">>;

const WELLNESS_TEXT_COLS = new Set([
  "notes",
  "hrv_status",
  "training_status",
  "garmin_raw",
  "last_water_reminder_at",
  "last_bedtime_reminder_at",
]);

export function getWellness(date?: string): WellnessRow | null {
  const d = localDate(date);
  const rows = queryJson<WellnessRow>(`SELECT * FROM wellness_state WHERE local_date = ${esc(d)};`);
  return rows[0] ?? null;
}

/** Insert-or-update the wellness row for a local date with the given fields. */
export function upsertWellness(date: string | undefined, patch: WellnessPatch): void {
  const d = localDate(date);
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;

  const cols = entries.map(([col]) => col);
  const formatVal = (col: string, value: unknown): string => {
    if (value === null) return "NULL";
    if (WELLNESS_TEXT_COLS.has(col)) return esc(value as string);
    return String(Number(value));
  };

  const insertCols = ["local_date", ...cols];
  const insertVals = [esc(d), ...entries.map(([col, v]) => formatVal(col, v))];
  const updates = entries.map(([col]) => `${col} = excluded.${col}`);
  updates.push("updated_at = datetime('now')");

  execute(
    `INSERT INTO wellness_state (${insertCols.join(", ")})
     VALUES (${insertVals.join(", ")})
     ON CONFLICT(local_date) DO UPDATE SET ${updates.join(", ")};`
  );
}
