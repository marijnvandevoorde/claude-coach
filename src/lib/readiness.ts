/**
 * Readiness signal-assembly — shared between the CLI checkin and the web app.
 *
 * Pulls the per-day wellness row plus the rolling-history signals (sleep-score
 * history, resting-HR baseline, and the HRV/sleep-regularity series derived from
 * the stored `garmin_raw` blobs) and feeds them to `computeReadiness`. This is
 * the *reconstructed* readiness path used when Garmin doesn't surface a native
 * Training Readiness score on the device; callers should prefer the cached
 * `readiness_score` when it exists.
 */
import { queryJson } from "../db/client.js";
import { getWellness, localDate } from "../db/wellness.js";
import { computeReadiness, type DerivedReadiness, type ReadinessSignals } from "./recovery.js";

function escapeString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Rolling mean of resting HR over recent days (excludes `beforeDate`). Needs a
 *  few samples to be meaningful — returns null until enough history exists. */
export async function restingHrBaseline(beforeDate: string): Promise<number | null> {
  const rows = await queryJson<{ resting_hr: number }>(
    `SELECT resting_hr FROM wellness_state
     WHERE resting_hr IS NOT NULL AND local_date < ${escapeString(beforeDate)}
     ORDER BY local_date DESC LIMIT 30;`
  );
  const vals = rows.map((row) => Number(row.resting_hr)).filter(Number.isFinite);
  if (vals.length < 5) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Rolling mean of sleep score over recent days (the "sleep history" factor). */
export async function sleepScoreHistory(beforeDate: string): Promise<number | null> {
  const rows = await queryJson<{ sleep_score: number }>(
    `SELECT sleep_score FROM wellness_state
     WHERE sleep_score IS NOT NULL AND local_date < ${escapeString(beforeDate)}
     ORDER BY local_date DESC LIMIT 5;`
  );
  const vals = rows.map((row) => Number(row.sleep_score)).filter(Number.isFinite);
  if (vals.length < 3) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Circular SD (in minutes) of a set of times-of-day, so the midnight wrap
 *  doesn't inflate the spread (e.g. 23:50 and 00:10 are 20 min apart, not 23h). */
function circularSdMinutes(mins: number[]): number {
  const TWO_PI = 2 * Math.PI;
  let sumSin = 0;
  let sumCos = 0;
  for (const m of mins) {
    const a = (m / 1440) * TWO_PI;
    sumSin += Math.sin(a);
    sumCos += Math.cos(a);
  }
  const r = Math.sqrt(sumSin ** 2 + sumCos ** 2) / mins.length;
  if (r >= 1) return 0;
  return (Math.sqrt(-2 * Math.log(r)) / TWO_PI) * 1440;
}

/**
 * Derive the richer HRV + sleep-regularity readiness inputs from the stored
 * `garmin_raw` blobs (no new Garmin fetch). Reads the recent window once and
 * returns: today's ln(RMSSD) with the rolling baseline mean/SD (for the SWC
 * band), and the SD of recent midsleep time-of-day. Each needs a week+ of
 * nights; fields stay null until enough history exists, so the model falls
 * back to the Garmin-band/status HRV path and simply omits sleep regularity.
 */
export async function recoveryHistoryFromRaw(date: string): Promise<{
  hrvLnRmssd: number | null;
  hrvLnRmssdMean: number | null;
  hrvLnRmssdSd: number | null;
  sleepRegularityMinutes: number | null;
}> {
  const out = {
    hrvLnRmssd: null as number | null,
    hrvLnRmssdMean: null as number | null,
    hrvLnRmssdSd: null as number | null,
    sleepRegularityMinutes: null as number | null,
  };
  const rows = await queryJson<{ local_date: string; garmin_raw: string }>(
    `SELECT local_date, garmin_raw FROM wellness_state
     WHERE garmin_raw IS NOT NULL AND local_date <= ${escapeString(date)}
     ORDER BY local_date DESC LIMIT 45;`
  );
  if (rows.length === 0) return out;

  const lnByDate: Array<{ date: string; ln: number }> = [];
  const midsleepMins: number[] = [];
  for (const row of rows) {
    let raw: Record<string, any>;
    try {
      raw = JSON.parse(row.garmin_raw) as Record<string, any>;
    } catch {
      continue;
    }
    const lastNight = raw?.hrv?.hrvSummary?.lastNightAvg;
    if (typeof lastNight === "number" && lastNight > 0)
      lnByDate.push({ date: row.local_date, ln: Math.log(lastNight) });
    const start = raw?.sleep?.sleepStartTimestampLocal;
    const end = raw?.sleep?.sleepEndTimestampLocal;
    if (typeof start === "number" && typeof end === "number" && end > start) {
      // Local-shifted epoch ms → midsleep time-of-day in minutes.
      midsleepMins.push(Math.floor((start + end) / 2 / 60000) % 1440);
    }
  }

  // HRV: today's ln(RMSSD) vs the baseline built from strictly-earlier nights.
  const todayLn = lnByDate.find((x) => x.date === date)?.ln ?? null;
  const baseline = lnByDate.filter((x) => x.date < date).map((x) => x.ln);
  if (todayLn != null && baseline.length >= 7) {
    const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / (baseline.length - 1);
    out.hrvLnRmssd = todayLn;
    out.hrvLnRmssdMean = mean;
    out.hrvLnRmssdSd = Math.sqrt(variance);
  }

  // Sleep regularity: spread of midsleep time-of-day across the recent window.
  if (midsleepMins.length >= 7) out.sleepRegularityMinutes = circularSdMinutes(midsleepMins);

  return out;
}

/**
 * Assemble all readiness signals for a given local date and compute the
 * reconstructed readiness. Returns null when no usable signal exists (or no
 * wellness row), mirroring `computeReadiness`'s contract.
 *
 * This is the *derived* path — it does not consult a native Garmin
 * `readiness_score`; callers that want to prefer the cached score should check
 * `wellness.readiness_score` first.
 */
export async function assembleReadiness(date?: string): Promise<DerivedReadiness | null> {
  const d = localDate(date);
  const wellness = await getWellness(d);
  if (!wellness) return null;

  const sleepHistoryScore = await sleepScoreHistory(d);
  // Prefer Garmin's own 7-day resting-HR average (available immediately);
  // fall back to our rolling DB mean once enough history exists.
  const rhrBaseline = wellness.rhr_7day_avg ?? (await restingHrBaseline(d));
  const hist = await recoveryHistoryFromRaw(d);

  const signals: ReadinessSignals = {
    sleepScore: wellness.sleep_score,
    acwr: wellness.acwr,
    hrvLnRmssd: hist.hrvLnRmssd,
    hrvLnRmssdMean: hist.hrvLnRmssdMean,
    hrvLnRmssdSd: hist.hrvLnRmssdSd,
    hrvWeeklyAvg: wellness.hrv_weekly_avg,
    hrvBaselineLow: wellness.hrv_baseline_low,
    hrvBaselineUpper: wellness.hrv_baseline_upper,
    hrvStatus: wellness.hrv_status,
    avgStress: wellness.avg_stress,
    sleepHistoryScore,
    sleepRegularityMinutes: hist.sleepRegularityMinutes,
    energy: wellness.subjective_energy,
    soreness: wellness.soreness,
    mood: wellness.mood,
    restingHr: wellness.resting_hr,
    restingHrBaseline: rhrBaseline,
  };

  return computeReadiness(signals);
}

/** Build the `ReadinessSignals` for a date without computing (for callers that
 *  want to pass them to `readinessContributions`). Returns null if no row. */
export async function assembleReadinessSignals(date?: string): Promise<ReadinessSignals | null> {
  const d = localDate(date);
  const wellness = await getWellness(d);
  if (!wellness) return null;
  const sleepHistoryScore = await sleepScoreHistory(d);
  const rhrBaseline = wellness.rhr_7day_avg ?? (await restingHrBaseline(d));
  const hist = await recoveryHistoryFromRaw(d);
  return {
    sleepScore: wellness.sleep_score,
    acwr: wellness.acwr,
    hrvLnRmssd: hist.hrvLnRmssd,
    hrvLnRmssdMean: hist.hrvLnRmssdMean,
    hrvLnRmssdSd: hist.hrvLnRmssdSd,
    hrvWeeklyAvg: wellness.hrv_weekly_avg,
    hrvBaselineLow: wellness.hrv_baseline_low,
    hrvBaselineUpper: wellness.hrv_baseline_upper,
    hrvStatus: wellness.hrv_status,
    avgStress: wellness.avg_stress,
    sleepHistoryScore,
    sleepRegularityMinutes: hist.sleepRegularityMinutes,
    energy: wellness.subjective_energy,
    soreness: wellness.soreness,
    mood: wellness.mood,
    restingHr: wellness.resting_hr,
    restingHrBaseline: rhrBaseline,
  };
}
