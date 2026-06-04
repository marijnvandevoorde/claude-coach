// Read/write client for the coach-app JSON API (same-origin, behind Cloudflare Access).
// Response shapes are the shared wire contract (src/shared/api-types) — re-exported
// here so screens keep importing them from "../api".
export type {
  Contribution,
  PlannedSession,
  DashboardPlan,
  Summary,
  CalendarDay,
  Trends,
  ActivityRow,
  ActivitySplit,
  ActivityDetail,
  JournalEntry,
  GarminRefreshStatus,
} from "../shared/api-types";
import type {
  Summary,
  CalendarDay,
  Trends,
  ActivityRow,
  ActivityDetail,
  JournalEntry,
  PlannedSession,
  GarminRefreshStatus,
} from "../shared/api-types";

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
  if (!r.ok) {
    let msg = `POST ${path} → ${r.status}`;
    try {
      const j = (await r.json()) as { error?: unknown };
      if (typeof j?.error === "string") msg = j.error;
    } catch {
      /* no JSON body — keep the status message */
    }
    throw new Error(msg);
  }
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
  courseFromActivity: (activityId: number, opts?: { name?: string; type?: string }) =>
    post<{ courseId: number | null; name: string }>("/course-from-activity", {
      activityId,
      ...opts,
    }),
  uploadRoute: (gpx: string, opts?: { name?: string; type?: string }) =>
    post<{ courseId: number | null; name: string; points?: number }>("/upload-route", {
      gpx,
      ...opts,
    }),
  // Upcoming planned sessions from the active plan (for the Activity screen).
  upcoming: (days = 21) =>
    get<{ hasActivePlan: boolean; sessions: PlannedSession[] }>(`/plan/upcoming${qs({ days })}`),
  // Every planned session in the active plan (for the calendar's planned-day markers).
  planSessions: () => get<{ hasActivePlan: boolean; sessions: PlannedSession[] }>(`/plan/sessions`),
  // Kick off a server-side Garmin sync (returns immediately; poll garminRefreshStatus).
  refreshGarmin: (date?: string) =>
    post<{ status: "started" | "running"; startedAt?: string }>("/garmin/refresh", { date }),
  garminRefreshStatus: () => get<GarminRefreshStatus>("/garmin/refresh"),
};
