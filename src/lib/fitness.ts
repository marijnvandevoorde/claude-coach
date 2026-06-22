// ============================================================================
// Current-fitness snapshot — weekly EFD/D+ rollups from logged activities.
//
// Turns the athlete's actual training history into the few numbers the
// periodizer anchors to: recent weekly EFD/D+ (the ramp's starting point), the
// longest recent run (the long-run starting point), and an inferred foundation
// (drives the ramp cap). Pure + unit-tested — the CLI queries the `activities`
// table and passes the rows in (mirrors how wellness.ts feeds recovery.ts).
// ============================================================================
import { efd } from "./loadModel.js";
import type { Foundation } from "./loadModel.js";

/** One activity, already normalized to local date + km/m. */
export interface ActivitySample {
  date: string; // local 'YYYY-MM-DD'
  sport: string; // 'run' | 'bike' | … (lowercased family)
  distanceKm: number;
  dPlusM: number;
  movingMin: number;
}

export interface WeekRollup {
  weekStart: string; // Monday 'YYYY-MM-DD'
  efd: number; // total EFD (run only — the trail currency)
  dPlus: number; // total vertical (run only)
  runMin: number;
  sessions: number; // run sessions
  longestRunEFD: number;
}

export interface FitnessSnapshot {
  asOf: string;
  weeksObserved: number;
  weeks: WeekRollup[]; // complete weeks, most recent first (capped)
  recentWeeklyEFD: number; // mean of the last up-to-4 complete weeks
  recentWeeklyDPlus: number;
  peakWeeklyEFD: number; // max over the observed window
  longestRunEFD: number; // longest single run (EFD) over the window
  weeklyRunSessions: number; // mean run sessions/week (complete weeks)
  efdTrend: "rising" | "flat" | "falling";
  foundation: Foundation; // inferred — drives the periodizer's ramp cap
}

/** Lowercase sport family. Treats every run variant (trail/virtual/treadmill) as "run". */
export function sportFamily(sport: string): string {
  const s = String(sport ?? "").toLowerCase();
  if (s.includes("run")) return "run";
  if (s.includes("ride") || s.includes("bik") || s.includes("cycl")) return "bike";
  if (s.includes("swim")) return "swim";
  if (s.includes("walk") || s.includes("hik")) return "hike";
  return s || "other";
}

/** Monday (ISO week start) for a 'YYYY-MM-DD' date, as 'YYYY-MM-DD'. */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Roll activities up into a fitness snapshot as of `asOf` (default = max activity
 * date). The week CONTAINING asOf is treated as partial and excluded from the
 * "recent" averages (it would understate a mid-week snapshot), but still counts
 * toward peak/longest. `windowWeeks` caps how far back the rollup table goes.
 */
export function computeFitnessSnapshot(
  activities: ActivitySample[],
  asOf?: string,
  windowWeeks = 12
): FitnessSnapshot {
  const dates = activities.map((a) => a.date).filter(Boolean);
  const effectiveAsOf =
    asOf ?? (dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : weekStartOf("1970-01-01"));
  const currentWeek = weekStartOf(effectiveAsOf);
  const cutoff = (() => {
    const d = new Date(`${currentWeek}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7 * (windowWeeks - 1));
    return d.toISOString().slice(0, 10);
  })();

  // Bucket run activities by week start.
  const byWeek = new Map<string, WeekRollup>();
  for (const a of activities) {
    if (sportFamily(a.sport) !== "run") continue;
    const ws = weekStartOf(a.date);
    if (ws < cutoff || ws > currentWeek) continue;
    const w =
      byWeek.get(ws) ??
      byWeek
        .set(ws, {
          weekStart: ws,
          efd: 0,
          dPlus: 0,
          runMin: 0,
          sessions: 0,
          longestRunEFD: 0,
        })
        .get(ws)!;
    const e = efd(a.distanceKm, a.dPlusM);
    w.efd = round1(w.efd + e);
    w.dPlus += Math.round(a.dPlusM || 0);
    w.runMin += Math.round(a.movingMin || 0);
    w.sessions += 1;
    w.longestRunEFD = Math.max(w.longestRunEFD, e);
  }

  const all = [...byWeek.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const complete = all.filter((w) => w.weekStart < currentWeek); // exclude the partial current week
  const recent = complete.slice(0, 4);

  const recentWeeklyEFD = round1(mean(recent.map((w) => w.efd)));
  const recentWeeklyDPlus = Math.round(mean(recent.map((w) => w.dPlus)));
  const peakWeeklyEFD = all.reduce((m, w) => Math.max(m, w.efd), 0);
  const longestRunEFD = all.reduce((m, w) => Math.max(m, w.longestRunEFD), 0);
  const weeklyRunSessions = round1(mean(complete.map((w) => w.sessions)));

  // Trend: last 2 complete weeks vs the 2 before them.
  const last2 = mean(complete.slice(0, 2).map((w) => w.efd));
  const prev2 = mean(complete.slice(2, 4).map((w) => w.efd));
  const efdTrend: FitnessSnapshot["efdTrend"] =
    prev2 === 0
      ? "flat"
      : last2 > prev2 * 1.07
        ? "rising"
        : last2 < prev2 * 0.93
          ? "falling"
          : "flat";

  return {
    asOf: effectiveAsOf,
    weeksObserved: complete.length,
    weeks: all.slice(0, windowWeeks),
    recentWeeklyEFD,
    recentWeeklyDPlus,
    peakWeeklyEFD,
    longestRunEFD,
    weeklyRunSessions,
    efdTrend,
    foundation: inferFoundation(complete, recentWeeklyEFD),
  };
}

/**
 * Infer training foundation from consistency + volume (drives the ramp cap).
 * Conservative on purpose — underestimating just ramps more gently.
 *  - beginner: little history or low volume
 *  - returning: some history but inconsistent (gaps) — body remembers, rebuild faster
 *  - advanced: consistent and high volume
 *  - intermediate: the default middle
 */
export function inferFoundation(complete: WeekRollup[], recentWeeklyEFD: number): Foundation {
  if (complete.length < 4 || recentWeeklyEFD < 20) return "beginner";
  const activeWeeks = complete.slice(0, 8).filter((w) => w.sessions >= 2).length;
  const window = Math.min(8, complete.length);
  const consistency = activeWeeks / window; // share of recent weeks with real training
  if (consistency >= 0.75 && recentWeeklyEFD >= 50) return "advanced";
  if (consistency < 0.6) return "returning";
  return "intermediate";
}
