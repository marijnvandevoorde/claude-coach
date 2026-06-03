// Read/write client for the coach-app JSON API (same-origin, behind Cloudflare Access).
const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return (await r.json()) as T;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return (await r.json()) as T;
}

const qs = (o: Record<string, unknown>): string => {
  const p = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return p ? `?${p}` : "";
};

export const api = {
  summary: (date?: string) => get<Summary>(`/summary${qs({ date })}`),
  calendar: (range?: { from?: string; to?: string }) =>
    get<CalendarDay[]>(`/calendar${qs(range ?? {})}`),
  trends: (days = 42) => get<Trends>(`/trends${qs({ days })}`),
  activities: (o: { limit?: number; before?: string; sport?: string } = {}) =>
    get<ActivityRow[]>(`/activities${qs(o)}`),
  activity: (id: number) => get<ActivityDetail>(`/activity/${id}`),
  journal: (o: { since?: string; until?: string; limit?: number } = {}) =>
    get<JournalEntry[]>(`/journal${qs(o)}`),
  logWater: (ml: number, date?: string) =>
    post<{ date: string; total_ml: number; goal_ml: number }>("/hydration", { ml, date }),
  logSubjective: (b: { energy?: number; mood?: number; date?: string }) =>
    post<unknown>("/subjective", b),
  addJournal: (b: { entry: string; tag?: string; date?: string }) => post<unknown>("/journal", b),
};

// --- response shapes (loose; refined as screens land) ---
export interface Contribution {
  key: "sleep" | "hrv" | "load" | "stress" | "subjective";
  label: string;
  points: number;
}
export interface Summary {
  date: string;
  wellness: Record<string, number | string | null> | null;
  hydration: { total_ml: number; goal_ml?: number };
  lastActivity: Record<string, unknown> | null;
  readiness?: {
    score: number | null;
    level: string;
    contributions: Contribution[];
    coverage: Record<string, boolean>;
  };
  sleep?: { hours: number | null; score: number | null; stages: Record<string, number> | null };
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
export interface ActivityDetail extends ActivityRow {
  track: number[][] | null;
  average_watts: number | null;
  total_elevation_gain: number | null;
  calories: number | null;
}
export interface JournalEntry {
  id: number;
  local_date: string;
  entry: string;
  tag: string | null;
  created_at: string | null;
}
