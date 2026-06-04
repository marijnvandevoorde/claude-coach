// Adapts raw API responses into the view models the screens consume.
import type {
  Summary,
  Trends,
  CalendarDay,
  ActivityRow,
  ActivityDetail,
  ActivitySplit,
  Contribution,
  DashboardPlan,
} from "../api";
import { normSport } from "./coach";

const num = (v: unknown): number | null =>
  v == null || v === "" ? null : typeof v === "number" ? v : Number(v);

export interface Factor {
  key: string;
  label: string;
  v: number;
}

export interface SleepStages {
  deep: number;
  light: number;
  rem: number;
  awake: number;
}

// The fully-derived "day" used by the dashboard + day detail.
export interface DayView {
  date: string;
  readiness: number | null;
  factors: Factor[];
  coverage: Record<string, boolean>;
  sleep_hours: number | null;
  sleep_score: number | null;
  sleep_stages: SleepStages | null;
  hrv: number | null;
  hrv_base_low: number | null;
  hrv_base_high: number | null;
  resting_hr: number | null;
  body_battery: number | null;
  acwr: number | null;
  load_acute: number | null;
  load_chronic: number | null;
  stress: number | null;
  steps: number | null;
  subjective: { energy?: number; mood?: number; soreness?: number } | null;
  plan: DashboardPlan | null;
  hasData: boolean;
}

function factorsFrom(contributions: Contribution[] | undefined): Factor[] {
  if (!contributions) return [];
  return contributions.map((c) => ({
    key: c.key,
    label: c.label,
    v: Math.round(c.points),
  }));
}

export function adaptSummary(s: Summary): DayView {
  const w = (s.wellness ?? {}) as Record<string, unknown>;
  const stages = s.sleep?.stages as SleepStages | null | undefined;
  const energy = num(w.subjective_energy);
  const mood = num(w.mood);
  const soreness = num(w.soreness);
  const subjective =
    energy != null || mood != null || soreness != null
      ? {
          energy: energy ?? undefined,
          mood: mood ?? undefined,
          soreness: soreness ?? undefined,
        }
      : null;
  return {
    date: s.date,
    readiness: s.readiness?.score ?? num(w.readiness_score),
    factors: factorsFrom(s.readiness?.contributions),
    coverage: s.readiness?.coverage ?? {},
    sleep_hours: s.sleep?.hours ?? num(w.sleep_hours),
    sleep_score: s.sleep?.score ?? num(w.sleep_score),
    sleep_stages: stages ?? null,
    hrv: num(w.hrv_weekly_avg),
    hrv_base_low: num(w.hrv_baseline_low),
    hrv_base_high: num(w.hrv_baseline_upper),
    resting_hr: num(w.resting_hr),
    body_battery: num(w.body_battery_morning) ?? num(w.body_battery_charged),
    acwr: num(w.acwr),
    load_acute: num(w.acute_load),
    load_chronic: num(w.chronic_load),
    stress: num(w.avg_stress),
    steps: num(w.total_steps),
    subjective,
    plan: s.plan ?? null,
    hasData: !!s.wellness,
  };
}

export interface TrendPoint {
  date: string;
  readiness: number | null;
  hrv: number | null;
  hrv_base_low: number | null;
  hrv_base_high: number | null;
  acwr: number | null;
  load_acute: number | null;
  load_chronic: number | null;
}

export function adaptTrendSeries(t: Trends): TrendPoint[] {
  return (t.series ?? []).map((r) => ({
    date: String(r.local_date ?? ""),
    readiness: num(r.readiness_score),
    hrv: num(r.hrv_weekly_avg),
    hrv_base_low: num(r.hrv_baseline_low),
    hrv_base_high: num(r.hrv_baseline_upper),
    acwr: num(r.acwr),
    load_acute: num(r.acute_load),
    load_chronic: num(r.chronic_load),
  }));
}

export interface WeeklyVolume {
  label: string;
  v: number;
  hl: boolean;
}

// weeklyVolume rows are per week+sport: { week, hours, km }. Sum hours per week.
export function adaptWeeklyVolume(t: Trends): WeeklyVolume[] {
  const buckets = new Map<string, number>();
  for (const r of t.weeklyVolume ?? []) {
    const week = String((r as Record<string, unknown>).week ?? "");
    const hours = num((r as Record<string, unknown>).hours) ?? 0;
    buckets.set(week, (buckets.get(week) ?? 0) + hours);
  }
  const keys = [...buckets.keys()].sort();
  const show = keys.slice(-8);
  return show.map((k, i) => ({
    label: k.replace(/^\d{4}-/, ""),
    v: Math.round((buckets.get(k) ?? 0) * 10) / 10,
    hl: i === show.length - 1,
  }));
}

export interface ActivityView {
  id: number;
  name: string;
  sport: string;
  date: string;
  distanceKm: number;
  durationMin: number;
  avg_hr: number | null;
  max_hr: number | null;
  suffer: number | null;
  elevation: number | null;
  race: boolean;
  has_track: boolean;
}

export function adaptActivityRow(a: ActivityRow): ActivityView {
  const name = a.name ?? "Activity";
  return {
    id: a.id,
    name,
    sport: normSport(a.sport_type),
    date: (a.start_date ?? "").slice(0, 10),
    distanceKm: a.distance != null ? Math.round((a.distance / 1000) * 10) / 10 : 0,
    durationMin: a.moving_time != null ? Math.round(a.moving_time / 60) : 0,
    avg_hr: a.average_heartrate != null ? Math.round(a.average_heartrate) : null,
    max_hr: null,
    suffer: a.suffer_score != null ? Math.round(a.suffer_score) : null,
    elevation: null,
    race: /race|marathon|\bpb\b|championship/i.test(name),
    has_track: !!a.has_track,
  };
}

export interface ActivityDetailView extends ActivityView {
  track: number[][] | null;
  calories: number | null;
  splits: ActivitySplit[];
  hrSeries: number[];
}

export function adaptActivityDetail(a: ActivityDetail): ActivityDetailView {
  const base = adaptActivityRow(a);
  const r = a as unknown as Record<string, unknown>;
  return {
    ...base,
    max_hr: num(r.max_heartrate),
    elevation: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain) : null,
    track: a.track ?? null,
    calories: a.calories,
    splits: Array.isArray(a.splits) ? a.splits : [],
    hrSeries: Array.isArray(a.hrSeries) ? a.hrSeries : [],
  };
}

export type { CalendarDay };
