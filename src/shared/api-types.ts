/**
 * The /api wire contract — the single source of truth for response shapes, shared
 * by the server (which produces them) and the React client (which consumes them).
 * TYPES ONLY: no runtime code, so `import type` from the client bundle erases to
 * nothing and the server's plan readers (src/db/plans.ts, src/server/plan-api.ts)
 * can derive from the same definitions instead of hand-mirroring them (which drifted).
 */

export interface Contribution {
  key: "sleep" | "hrv" | "load" | "stress" | "subjective";
  label: string;
  points: number;
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
  /** Stable per-day-workout key (see plans.workoutKey); joins to garmin_pushed_workouts.push_key. */
  key?: string;
  syncedToGarmin?: boolean;
}

export interface DashboardPlan {
  hasActivePlan: boolean;
  today: PlannedSession[];
  next: PlannedSession | null;
}

export interface Summary {
  date: string;
  wellness: Record<string, number | string | null> | null;
  hydration: { total_ml: number; goal_ml?: number };
  lastActivity: Record<string, unknown> | null;
  readiness?: {
    score: number | null;
    level: string | null; // the server emits null when readiness can't be reconstructed
    contributions: Contribution[];
    coverage: Record<string, boolean>;
  };
  sleep?: { hours: number | null; score: number | null; stages: Record<string, number> | null };
  plan?: DashboardPlan;
}

export interface CalendarDay {
  date: string;
  readiness: number | null;
  load: number | null;
  sleep: number | null;
  hrv: number | null;
  gap: boolean;
}

export interface Trends {
  days: number;
  series: Array<Record<string, number | string | null>>;
  weeklyVolume: Array<Record<string, unknown>>;
}

export interface ActivityRow {
  id: number;
  name: string | null;
  sport_type: string | null;
  start_date: string | null;
  distance: number | null;
  moving_time: number | null;
  average_heartrate: number | null;
  suffer_score: number | null;
  has_track: number;
}

export interface ActivitySplit {
  idx: number;
  distanceM: number;
  durationS: number;
  paceSecPerKm: number | null;
  avgHr: number | null;
}

export interface ActivityDetail extends ActivityRow {
  track: number[][] | null;
  average_watts: number | null;
  total_elevation_gain: number | null;
  calories: number | null;
  splits: ActivitySplit[];
  hrSeries: number[];
}

export interface JournalEntry {
  id: number;
  local_date: string;
  entry: string;
  tag: string | null;
  created_at: string | null;
}

export interface GarminRefreshStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  error?: string;
}
