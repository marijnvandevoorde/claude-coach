import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackfill, type BackfillSink } from "../../src/garmin/backfill.js";

function res(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: () => null },
    text: async () => (body == null ? "" : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response;
}

describe("runBackfill", () => {
  let dir: string;
  let tokenFile: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bf-"));
    tokenFile = join(dir, "garmin_tokens.json");
    writeFileSync(tokenFile, JSON.stringify({ di_refresh_token: "r", di_client_id: "c" }));
    process.env.GARMINTOKENS = tokenFile;
  });
  afterEach(() => {
    delete process.env.GARMINTOKENS;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("range path maps every endpoint to the right wellness columns + stores activities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("diauth")) return res({ access_token: "a", refresh_token: "r2" });
        if (url.includes("/activitylist-service/"))
          return res([
            {
              activityId: 1,
              activityName: "Run",
              activityType: { typeKey: "running" },
              duration: 3600,
              startTimeGMT: "2026-05-30 10:00:00",
            },
          ]);
        if (url.includes("/stats/steps/"))
          return res([{ calendarDate: "2026-05-30", totalSteps: 21218, totalDistance: 24588 }]);
        if (url.includes("/stats/floors/"))
          return res([{ calendarDate: "2026-05-30", values: { wellnessFloorsAscended: 137 } }]);
        if (url.includes("/stats/stress/"))
          return res([{ calendarDate: "2026-05-30", values: { overallStressLevel: 24 } }]);
        if (url.includes("/stats/heartRate/"))
          return res([{ calendarDate: "2026-05-30", values: { restingHR: 35 } }]);
        if (url.includes("/stats/im/"))
          return res([{ calendarDate: "2026-05-30", moderateValue: 5, vigorousValue: 87 }]);
        if (url.includes("/bodyBattery/")) return res([{ date: "2026-05-30", charged: 59 }]);
        if (url.includes("/hrv-service/"))
          return res({
            hrvSummaries: [
              {
                calendarDate: "2026-05-30",
                weeklyAvg: 63,
                status: "LOW",
                baseline: { balancedLow: 67, balancedUpper: 79 },
              },
            ],
          });
        return res(null);
      })
    );
    const saved = new Map<string, any>();
    const acts: any[] = [];
    const sink: BackfillSink = {
      saveWellness: async (d, p) => void saved.set(d, { ...(saved.get(d) || {}), ...p }),
      saveActivity: async (a) => void acts.push(a),
      hasFullSnapshot: async () => false,
    };
    const r = await runBackfill({ from: "2026-05-30", to: "2026-05-30", delayMs: 0 }, sink);
    expect(r.activities).toBe(1);
    expect(acts[0].sport_type).toBe("Run");
    expect(saved.get("2026-05-30")).toMatchObject({
      total_steps: 21218,
      total_distance_m: 24588,
      floors_climbed: 137,
      avg_stress: 24,
      resting_hr: 35,
      intensity_min_moderate: 5,
      intensity_min_vigorous: 87,
      body_battery_charged: 59,
      hrv_weekly_avg: 63,
      hrv_status: "low",
      hrv_baseline_low: 67,
      hrv_baseline_upper: 79,
    });
  });

  it("--full skips days that already have a full snapshot (resumable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("diauth")) return res({ access_token: "a", refresh_token: "r2" });
        if (url.includes("/activitylist-service/")) return res([]);
        return res(null);
      })
    );
    const sink: BackfillSink = {
      saveWellness: async () => {},
      saveActivity: async () => {},
      hasFullSnapshot: async () => true, // every day already done
    };
    const r = await runBackfill(
      { from: "2026-05-30", to: "2026-05-31", full: true, delayMs: 0 },
      sink
    );
    expect(r.skipped).toBe(2);
    expect(r.fullDays).toBe(0);
  });
});
