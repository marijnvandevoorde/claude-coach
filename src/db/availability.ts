/**
 * Athlete training availability — a single durable row (id = 1) the periodizer
 * reads to place sessions: which days, how many hours, which day the long run
 * anchors. Athlete-level on purpose (it outlives any one goal). Asked once by the
 * skill, persisted here. Mirrors the reminder_prefs accessor in src/db/wellness.ts.
 */
import { execute, queryJson } from "./client.js";
import { getDialect } from "./dialect.js";
import type { Goal } from "./goals.js";

function esc(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Canonical lowercase day tokens, in week order (used to normalize input). */
export const DAY_TOKENS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayToken = (typeof DAY_TOKENS)[number];

export interface AvailabilityRow {
  id: number;
  days_of_week: string | null; // JSON array string, e.g. '["tue","thu","sat","sun"]'
  weekly_hours: number | null;
  long_day: string | null;
  doubles_ok: number; // 0/1
  notes: string | null;
  updated_at: string | null;
}

/** Parsed, ergonomic view of the row (days as an array, doubles as a bool). */
export interface Availability {
  days: DayToken[];
  weeklyHours: number | null;
  longDay: DayToken | null;
  doublesOk: boolean;
  notes: string | null;
  updatedAt: string | null;
}

/** Coerce a free day string ("Saturday", "sat", "SAT") to a canonical token, or null. */
export function normalizeDay(value: string | null | undefined): DayToken | null {
  if (!value) return null;
  const v = String(value).trim().toLowerCase().slice(0, 3);
  return (DAY_TOKENS as readonly string[]).includes(v) ? (v as DayToken) : null;
}

/** Parse a days input — a JSON array, or a comma/space-separated list — into tokens
 *  in week order, de-duplicated. */
export function parseDays(input: string | string[] | null | undefined): DayToken[] {
  if (input == null) return [];
  let parts: string[];
  if (Array.isArray(input)) {
    parts = input.map(String);
  } else {
    const s = String(input).trim();
    if (s.startsWith("[")) {
      try {
        parts = (JSON.parse(s) as unknown[]).map(String);
      } catch {
        parts = s.split(/[,\s]+/);
      }
    } else {
      parts = s.split(/[,\s]+/);
    }
  }
  const seen = new Set<DayToken>();
  for (const p of parts) {
    const t = normalizeDay(p);
    if (t) seen.add(t);
  }
  return DAY_TOKENS.filter((d) => seen.has(d));
}

function toView(row: AvailabilityRow): Availability {
  return {
    days: parseDays(row.days_of_week),
    weeklyHours: row.weekly_hours ?? null,
    longDay: normalizeDay(row.long_day),
    doublesOk: Boolean(row.doubles_ok),
    notes: row.notes ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function getAvailabilityRow(): Promise<AvailabilityRow> {
  const rows = await queryJson<AvailabilityRow>("SELECT * FROM athlete_availability WHERE id = 1;");
  if (rows.length > 0) return rows[0];
  // Schema seeds this row, but be defensive if it's somehow missing.
  await execute(`${getDialect().insertIgnoreVerb()} INTO athlete_availability (id) VALUES (1);`);
  return (await queryJson<AvailabilityRow>("SELECT * FROM athlete_availability WHERE id = 1;"))[0];
}

/** The parsed, ergonomic availability the skill + periodizer consume. */
export async function getAvailability(): Promise<Availability> {
  return toView(await getAvailabilityRow());
}

export interface AvailabilityPatch {
  days?: string | string[]; // normalized + stored as a JSON array
  weeklyHours?: number | null;
  longDay?: string | null;
  doublesOk?: boolean;
  notes?: string | null;
}

export async function updateAvailability(patch: AvailabilityPatch): Promise<void> {
  const sets: string[] = [];
  if (patch.days !== undefined) {
    const days = parseDays(patch.days);
    sets.push(`days_of_week = ${esc(JSON.stringify(days))}`);
  }
  if (patch.weeklyHours !== undefined) {
    sets.push(`weekly_hours = ${patch.weeklyHours == null ? "NULL" : Number(patch.weeklyHours)}`);
  }
  if (patch.longDay !== undefined) {
    sets.push(`long_day = ${esc(normalizeDay(patch.longDay))}`);
  }
  if (patch.doublesOk !== undefined) {
    sets.push(`doubles_ok = ${patch.doublesOk ? 1 : 0}`);
  }
  if (patch.notes !== undefined) {
    sets.push(`notes = ${esc(patch.notes)}`);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = ${getDialect().now()}`);
  // Ensure the row exists, then update it.
  await getAvailabilityRow();
  await execute(`UPDATE athlete_availability SET ${sets.join(", ")} WHERE id = 1;`);
}

/** True once the periodizer has enough to place sessions: at least the training
 *  days and a weekly-hours budget. The long day defaults to the latest weekend day
 *  available, so it's not strictly required. */
export function isAvailabilityComplete(a: Availability): boolean {
  return a.days.length > 0 && a.weeklyHours != null && a.weeklyHours > 0;
}

/**
 * Resolve the availability the periodizer should use, applying any future per-goal
 * override (none today — goals carry no override column yet, so this just returns
 * the athlete default; the seam is here so T5/T12 can prefer a goal override later).
 */
export function resolveAvailability(base: Availability, _goal?: Goal | null): Availability {
  return base;
}
