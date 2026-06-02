import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchGarminSnapshot } from "../../src/garmin/snapshot.js";

const DATE = "2026-06-01";
let dir: string;
let tokenFile: string;

function res(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => (body == null ? "" : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response;
}

function mockFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("diauth.garmin.com")) {
        return res({ access_token: "newaccess", refresh_token: "r1" });
      }
      for (const [frag, body] of Object.entries(routes)) {
        if (url.includes(frag)) return res(body);
      }
      return res(null);
    })
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "garmin-test-"));
  tokenFile = join(dir, "garmin_tokens.json");
  writeFileSync(
    tokenFile,
    JSON.stringify({ di_refresh_token: "r0", di_client_id: "c0", di_token: "t0" })
  );
  process.env.GARMINTOKENS = tokenFile;
});

afterEach(() => {
  delete process.env.GARMINTOKENS;
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("fetchGarminSnapshot", () => {
  it("maps wellness signals + activities and rotates the refresh token", async () => {
    mockFetch({
      "/userprofile-service/socialProfile": { displayName: "athlete1" },
      "/metrics-service/metrics/trainingreadiness/": [{ score: 78 }],
      "/wellness-service/wellness/dailySleepData/": {
        dailySleepDTO: { sleepTimeSeconds: 28800, sleepScores: { overall: { value: 83 } } },
      },
      "/hrv-service/hrv/": {
        hrvSummary: {
          status: "BALANCED",
          weeklyAvg: 64,
          baseline: { balancedLow: 66, balancedUpper: 79 },
        },
      },
      "/usersummary-service/usersummary/daily/": {
        restingHeartRate: 35,
        bodyBatteryAtWakeTime: 97,
        averageStressLevel: 16,
        totalSteps: 14405,
        totalDistanceMeters: 17637,
        floorsAscended: 124.49,
        moderateIntensityMinutes: 3,
        vigorousIntensityMinutes: 64,
        activeKilocalories: 914,
        totalKilocalories: 3038,
        averageSpo2: 97,
        avgWakingRespirationValue: 13,
        lastSevenDaysAvgRestingHeartRate: 36,
        bodyBatteryChargedValue: 73,
      },
      "/metrics-service/metrics/trainingstatus/aggregated/": {
        mostRecentVO2Max: { generic: { vo2MaxPreciseValue: 59.6, vo2MaxValue: 60 } },
        latestTrainingStatusData: {
          "123": {
            trainingStatusFeedbackPhrase: "PRODUCTIVE_8",
            acuteTrainingLoadDTO: {
              dailyAcuteChronicWorkloadRatio: 1.6,
              dailyTrainingLoadAcute: 785,
              dailyTrainingLoadChronic: 470,
            },
          },
        },
      },
      "/activitylist-service/activities/search/activities": [
        {
          activityId: 111,
          activityName: "Morning Run",
          activityType: { typeKey: "trail_running" },
          duration: 3600,
          movingDuration: 0, // Garmin sometimes sends 0 → should fall back to duration
          distance: 10000,
          elevationGain: 500,
          averageHR: 150,
        },
      ],
    });

    const out = await fetchGarminSnapshot(DATE);

    expect(out.errors).toEqual([]);
    expect(out.wellness).toMatchObject({
      readiness_score: 78,
      sleep_hours: 8,
      sleep_score: 83,
      hrv_status: "balanced",
      hrv_weekly_avg: 64,
      hrv_baseline_low: 66,
      hrv_baseline_upper: 79,
      resting_hr: 35,
      body_battery_morning: 97,
      avg_stress: 16,
      training_status: "Productive 8",
      acwr: 1.6,
      acute_load: 785,
      chronic_load: 470,
      // expanded metrics
      vo2max: 59.6,
      total_steps: 14405,
      total_distance_m: 17637,
      floors_climbed: 124,
      intensity_min_moderate: 3,
      intensity_min_vigorous: 64,
      active_calories: 914,
      total_calories: 3038,
      avg_spo2: 97,
      avg_waking_respiration: 13,
      rhr_7day_avg: 36,
      body_battery_charged: 73,
    });

    // garmin_raw blob carries the rich/nested data for the MCP to hand Claude.
    expect(typeof out.wellness.garmin_raw).toBe("string");
    const blob = JSON.parse(out.wellness.garmin_raw as string);
    expect(blob.trainingStatus.mostRecentVO2Max.generic.vo2MaxPreciseValue).toBe(59.6);
    expect(blob.summary.totalSteps).toBe(14405);

    expect(out.activities).toHaveLength(1);
    const a = out.activities[0];
    expect(a.id).toBe(111);
    expect(a.sport_type).toBe("Run");
    expect(a.moving_time).toBe(3600); // fell back from movingDuration:0 to duration

    // The rotated refresh token is persisted back to the store.
    expect(JSON.parse(readFileSync(tokenFile, "utf-8")).di_refresh_token).toBe("r1");
  });

  it("negative stress (Garmin's no-data sentinel) is dropped", async () => {
    mockFetch({
      "/userprofile-service/socialProfile": { displayName: "athlete1" },
      "/usersummary-service/usersummary/daily/": {
        restingHeartRate: 40,
        averageStressLevel: -1,
      },
    });
    const out = await fetchGarminSnapshot(DATE);
    expect(out.wellness.resting_hr).toBe(40);
    expect("avg_stress" in out.wellness).toBe(false);
  });

  it("returns an error (does not throw) when tokens are incomplete", async () => {
    writeFileSync(tokenFile, JSON.stringify({ di_token: "t0" })); // no refresh token / client id
    const out = await fetchGarminSnapshot(DATE);
    expect(out.wellness).toEqual({});
    expect(out.activities).toEqual([]);
    expect(out.errors[0]).toMatch(/tokens\/refresh/);
  });
});
