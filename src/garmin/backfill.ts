/**
 * Backfill historical Garmin data into the local DB, rate-limit-aware.
 *
 * - Activities: paginate the activity list back to `from` (cheap, full history).
 * - Wellness (default): the multi-day "range" endpoints in ≤28-day chunks
 *   (steps/distance, floors, stress, resting HR, intensity minutes, body-battery
 *   charged, HRV) — a useful subset in very few calls.
 * - Wellness (--full): a per-day snapshot for every date (the COMPLETE metric set
 *   incl. sleep, training status/load, VO2max, calories, SpO2, respiration, and the
 *   garmin_raw blob). Heavier; resumable (skips days that already have a full
 *   snapshot unless --force).
 *
 * The GarminClient already backs off on HTTP 429; we add a small inter-call delay.
 * DB writes go through an injected sink so this module stays DB-agnostic.
 */
import { GarminClient } from "./client.js";
import { fetchGarminSnapshot, mapActivity } from "./snapshot.js";

export interface BackfillSink {
  saveWellness(date: string, patch: Record<string, number | string | null>): Promise<void>;
  saveActivity(a: Record<string, unknown>): Promise<void>;
  /** True if `date` already has a full per-day snapshot (a garmin_raw blob). */
  hasFullSnapshot(date: string): Promise<boolean>;
}

export interface BackfillOpts {
  from: string;
  to: string;
  full?: boolean;
  force?: boolean;
  delayMs?: number;
}

export interface BackfillResult {
  activities: number;
  wellnessDays: number;
  fullDays: number;
  skipped: number;
  errors: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
function chunks(from: string, to: string, size: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let s = from;
  while (s <= to) {
    let e = addDays(s, size - 1);
    if (e > to) e = to;
    out.push([s, e]);
    s = addDays(e, 1);
  }
  return out;
}

type Obj = Record<string, any>;

/** Fetch the multi-day "range" wellness endpoints and merge them per date. */
async function rangeWellness(
  client: GarminClient,
  from: string,
  to: string,
  errors: string[]
): Promise<Map<string, Record<string, number | string | null>>> {
  const days = new Map<string, Record<string, number | string | null>>();
  const merge = (date: string, patch: Record<string, number | string | null>) => {
    if (!date) return;
    days.set(date, { ...(days.get(date) || {}), ...patch });
  };
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await attempt("steps", async () => {
    const d =
      (await client.get<Obj[]>(`/usersummary-service/stats/steps/daily/${from}/${to}`)) ?? [];
    for (const x of d)
      merge(x.calendarDate, {
        total_steps: toInt(x.totalSteps),
        total_distance_m: toInt(x.totalDistance),
      });
  });
  await attempt("floors", async () => {
    const d =
      (await client.get<Obj[]>(`/usersummary-service/stats/floors/daily/${from}/${to}`)) ?? [];
    for (const x of d)
      merge(x.calendarDate, { floors_climbed: toInt(x.values?.wellnessFloorsAscended) });
  });
  await attempt("stress", async () => {
    const d =
      (await client.get<Obj[]>(`/usersummary-service/stats/stress/daily/${from}/${to}`)) ?? [];
    for (const x of d) {
      const v = x.values?.overallStressLevel;
      if (v != null && v >= 0) merge(x.calendarDate, { avg_stress: toInt(v) });
    }
  });
  await attempt("rhr", async () => {
    const d =
      (await client.get<Obj[]>(`/usersummary-service/stats/heartRate/daily/${from}/${to}`)) ?? [];
    for (const x of d) merge(x.calendarDate, { resting_hr: toInt(x.values?.restingHR) });
  });
  await attempt("intensity", async () => {
    const d = (await client.get<Obj[]>(`/usersummary-service/stats/im/daily/${from}/${to}`)) ?? [];
    for (const x of d)
      merge(x.calendarDate, {
        intensity_min_moderate: toInt(x.moderateValue),
        intensity_min_vigorous: toInt(x.vigorousValue),
      });
  });
  await attempt("bodybattery", async () => {
    const d =
      (await client.get<Obj[]>(
        `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${from}&endDate=${to}`
      )) ?? [];
    for (const x of d) merge(x.date, { body_battery_charged: toInt(x.charged) });
  });
  await attempt("hrv", async () => {
    const r = await client.get<Obj>(`/hrv-service/hrv/daily/${from}/${to}`);
    const arr: Obj[] = Array.isArray(r)
      ? r
      : ((Object.values(r ?? {}).find((v) => Array.isArray(v)) as Obj[]) ?? []);
    for (const x of arr) {
      const patch: Record<string, number | string | null> = {};
      if (x.weeklyAvg != null) patch.hrv_weekly_avg = x.weeklyAvg;
      if (x.status) patch.hrv_status = String(x.status).toLowerCase();
      if (x.baseline?.balancedLow != null) patch.hrv_baseline_low = toInt(x.baseline.balancedLow);
      if (x.baseline?.balancedUpper != null)
        patch.hrv_baseline_upper = toInt(x.baseline.balancedUpper);
      merge(x.calendarDate, patch);
    }
  });

  return days;
}

export async function runBackfill(opts: BackfillOpts, sink: BackfillSink): Promise<BackfillResult> {
  const result: BackfillResult = {
    activities: 0,
    wellnessDays: 0,
    fullDays: 0,
    skipped: 0,
    errors: [],
  };
  const delay = opts.delayMs ?? 400;
  const client = await GarminClient.create();

  // 1. Activities — paginate back until before `from`.
  try {
    const limit = 100;
    for (let start = 0; ; start += limit) {
      const page =
        (await client.get<Obj[]>(
          `/activitylist-service/activities/search/activities?start=${start}&limit=${limit}`
        )) ?? [];
      if (page.length === 0) break;
      let reachedOld = false;
      for (const a of page) {
        const t = String(a.startTimeGMT || a.startTimeLocal || "").slice(0, 10);
        if (t && t < opts.from) {
          reachedOld = true;
          continue;
        }
        if (t && t > opts.to) continue;
        const mapped = mapActivity(a);
        if (mapped.id != null) {
          await sink.saveActivity(mapped);
          result.activities++;
        }
      }
      if (reachedOld || page.length < limit) break;
      await sleep(delay);
    }
  } catch (e) {
    result.errors.push(`activities: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Wellness.
  if (opts.full) {
    // Per-day complete snapshot (resumable: skip days that already have a blob).
    for (const date of eachDate(opts.from, opts.to)) {
      if (!opts.force && (await sink.hasFullSnapshot(date))) {
        result.skipped++;
        continue;
      }
      const snap = await fetchGarminSnapshot(date, client);
      if (Object.keys(snap.wellness).length > 0) {
        await sink.saveWellness(date, snap.wellness);
        result.fullDays++;
      }
      for (const a of snap.activities) if (a.id != null) await sink.saveActivity(a);
      for (const err of snap.errors) result.errors.push(`${date}/${err}`);
      await sleep(delay);
    }
  } else {
    // Fast range path, in 28-day chunks.
    for (const [s, e] of chunks(opts.from, opts.to, 28)) {
      const days = await rangeWellness(client, s, e, result.errors);
      for (const [date, patch] of days) {
        if (Object.keys(patch).length > 0) {
          await sink.saveWellness(date, patch);
          result.wellnessDays++;
        }
      }
      await sleep(delay);
    }
  }

  return result;
}
