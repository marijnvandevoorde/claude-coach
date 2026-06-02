/**
 * Fetch a day's Garmin Connect snapshot + recent activities, as a plain object.
 *
 * This is the TypeScript port of the former `scripts/garmin_fetch.py`. Every
 * field is best-effort: a failure on one metric is recorded in `errors` and the
 * rest still come through, so a Garmin API change never produces *no* data.
 * It returns data only — the CLI (`garmin-fetch`) ingests it through the tested
 * DB upsert paths, keeping the schema in one place.
 */
import { GarminClient } from "./client.js";

export interface GarminFetchPayload {
  date: string;
  wellness: Record<string, number | string | null>;
  activities: Array<Record<string, unknown>>;
  errors: string[];
}

// Garmin activityType.typeKey -> the sport vocabulary used in the activities table.
const SPORT: Record<string, string> = {
  running: "Run",
  trail_running: "Run",
  treadmill_running: "Run",
  track_running: "Run",
  cycling: "Ride",
  road_biking: "Ride",
  mountain_biking: "Ride",
  gravel_cycling: "Ride",
  indoor_cycling: "Ride",
  virtual_ride: "Ride",
  lap_swimming: "Swim",
  open_water_swimming: "Swim",
  swimming: "Swim",
  walking: "Walk",
  hiking: "Hike",
  strength_training: "Workout",
};

type Obj = Record<string, any>;

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Lowercase then capitalize each word — matches Python's str.title(). */
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function mapActivity(a: Obj): Record<string, unknown> {
  const typeKey = String((a.activityType ?? {}).typeKey ?? "").toLowerCase();
  const sport = SPORT[typeKey] ?? (typeKey ? titleCase(typeKey.replace(/_/g, " ")) : "Workout");
  const aid = a.activityId;
  const dur = a.duration;
  const moving = a.movingDuration || dur; // Garmin sends movingDuration=0 → fall back to duration
  return {
    id: aid != null ? Math.trunc(Number(aid)) : null,
    name: a.activityName ?? null,
    sport_type: sport,
    start_date: a.startTimeGMT ?? null,
    elapsed_time: toInt(dur),
    moving_time: toInt(moving),
    distance: a.distance ?? null,
    total_elevation_gain: a.elevationGain ?? null,
    average_speed: a.averageSpeed ?? null,
    max_speed: a.maxSpeed ?? null,
    average_heartrate: a.averageHR ?? null,
    max_heartrate: a.maxHR ?? null,
    average_cadence:
      (a.averageRunningCadenceInStepsPerMinute || a.averageBikingCadenceInRevPerMinute) ?? null,
    calories: a.calories ?? null,
    raw: a,
  };
}

export async function fetchGarminSnapshot(date: string): Promise<GarminFetchPayload> {
  const out: GarminFetchPayload = { date, wellness: {}, activities: [], errors: [] };

  let client: GarminClient;
  try {
    client = await GarminClient.create();
  } catch (e) {
    out.errors.push(`tokens/refresh: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }

  const w = out.wellness;
  let displayName: string | null = null;

  const attempt = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      out.errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await attempt("profile", async () => {
    const p = (await client.get<Obj>("/userprofile-service/socialProfile")) ?? {};
    displayName = p.displayName ?? null;
  });

  await attempt("readiness", async () => {
    let d: any = await client.get("/metrics-service/metrics/trainingreadiness/" + date);
    if (Array.isArray(d) && d.length) d = d[0];
    if (d && typeof d === "object" && d.score != null) w.readiness_score = toInt(d.score);
  });

  await attempt("sleep", async () => {
    if (!displayName) return;
    const d =
      (await client.get<Obj>(
        `/wellness-service/wellness/dailySleepData/${displayName}` +
          `?date=${date}&nonSleepBufferMinutes=60`
      )) ?? {};
    const dto: Obj = d.dailySleepDTO ?? {};
    if (dto.sleepTimeSeconds) w.sleep_hours = Math.round((dto.sleepTimeSeconds / 3600) * 100) / 100;
    const overall: Obj = (dto.sleepScores ?? {}).overall ?? {};
    if (overall.value != null) w.sleep_score = toInt(overall.value);
  });

  await attempt("hrv", async () => {
    // HRV Status is the 7-day overnight average vs. the personal baseline band.
    const summ: Obj = ((await client.get<Obj>("/hrv-service/hrv/" + date)) ?? {}).hrvSummary ?? {};
    if (summ.status) w.hrv_status = String(summ.status).toLowerCase();
    if (summ.weeklyAvg != null) w.hrv_weekly_avg = summ.weeklyAvg;
    const base: Obj = summ.baseline ?? {};
    if (base.balancedLow != null) w.hrv_baseline_low = toInt(base.balancedLow);
    if (base.balancedUpper != null) w.hrv_baseline_upper = toInt(base.balancedUpper);
  });

  await attempt("stats", async () => {
    if (!displayName) return;
    const d =
      (await client.get<Obj>(
        `/usersummary-service/usersummary/daily/${displayName}?calendarDate=${date}`
      )) ?? {};
    if (d.restingHeartRate != null) w.resting_hr = toInt(d.restingHeartRate);
    // Body Battery at wake time is the recovery-relevant value (not the daytime peak).
    let bb = d.bodyBatteryAtWakeTime;
    if (bb == null) bb = d.bodyBatteryMostRecentValue;
    if (bb != null && bb >= 0) w.body_battery_morning = toInt(bb);
    const stress = d.averageStressLevel;
    if (stress != null && stress >= 0) w.avg_stress = toInt(stress); // Garmin uses negatives for "no data"
  });

  await attempt("training", async () => {
    // Training Status label + the acute/chronic load and ACWR that drive it.
    const d =
      (await client.get<Obj>("/metrics-service/metrics/trainingstatus/aggregated/" + date)) ?? {};
    const latest: Obj =
      (d.mostRecentTrainingStatus ?? {}).latestTrainingStatusData ??
      d.latestTrainingStatusData ??
      {};
    for (const v of Object.values<any>(latest)) {
      if (!v || typeof v !== "object") continue;
      const phrase = v.trainingStatusFeedbackPhrase ?? v.trainingStatus;
      if (phrase && !("training_status" in w)) {
        w.training_status = titleCase(String(phrase).replace(/_/g, " "));
      }
      const acute: Obj = v.acuteTrainingLoadDTO ?? {};
      if (acute.dailyAcuteChronicWorkloadRatio != null)
        w.acwr = acute.dailyAcuteChronicWorkloadRatio;
      if (acute.dailyTrainingLoadAcute != null) w.acute_load = toInt(acute.dailyTrainingLoadAcute);
      if (acute.dailyTrainingLoadChronic != null)
        w.chronic_load = toInt(acute.dailyTrainingLoadChronic);
      if ("acwr" in w) break;
    }
  });

  await attempt("activities", async () => {
    const d =
      (await client.get<Obj[]>(
        "/activitylist-service/activities/search/activities?start=0&limit=15"
      )) ?? [];
    for (const a of d) {
      try {
        out.activities.push(mapActivity(a));
      } catch (e) {
        out.errors.push(`activity: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  });

  return out;
}
