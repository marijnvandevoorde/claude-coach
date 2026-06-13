import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkoutPayload, pushWorkouts, paceToMps } from "../../src/garmin/workouts.js";

function res(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => (body == null ? "" : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response;
}

describe("buildWorkoutPayload", () => {
  it("maps a timed run with an HR target", () => {
    const p = buildWorkoutPayload({
      sport: "run",
      name: "Easy",
      durationMinutes: 30,
      targetHR: { low: 120, high: 140 },
    }) as any;
    expect(p.sportType.sportTypeKey).toBe("running");
    const step = p.workoutSegments[0].workoutSteps[0];
    expect(step.endCondition.conditionTypeKey).toBe("time");
    expect(step.endConditionValue).toBe(1800); // 30 min → seconds
    expect(step.targetType.workoutTargetTypeKey).toBe("heart.rate.zone");
    expect(step.targetValueOne).toBe(120);
    expect(step.targetValueTwo).toBe(140);
  });

  it("maps a distance workout with no target", () => {
    const p = buildWorkoutPayload({ sport: "ride", name: "Ride", distanceMeters: 40000 }) as any;
    expect(p.sportType.sportTypeKey).toBe("cycling");
    const step = p.workoutSegments[0].workoutSteps[0];
    expect(step.endCondition.conditionTypeKey).toBe("distance");
    expect(step.endConditionValue).toBe(40000);
    expect(step.targetType.workoutTargetTypeKey).toBe("no.target");
  });

  it("uses a pace target (m/s) when given targetPace", () => {
    const p = buildWorkoutPayload({
      sport: "run",
      name: "Tempo",
      durationMinutes: 40,
      targetPace: { low: "5:00/km", high: "4:40/km" },
    }) as any;
    const step = p.workoutSegments[0].workoutSteps[0];
    expect(step.targetType.workoutTargetTypeKey).toBe("pace.zone");
    expect(step.targetValueOne).toBeCloseTo(3.333, 2); // 5:00/km is the slower → lower speed
    expect(step.targetValueTwo).toBeCloseTo(3.571, 2); // 4:40/km is the faster → higher speed
  });
});

describe("paceToMps", () => {
  it("parses km and mi paces, rejects junk", () => {
    expect(paceToMps("5:00/km")).toBeCloseTo(3.333, 2);
    expect(paceToMps("8:03/mi")).toBeCloseTo(3.332, 2);
    expect(paceToMps("nonsense")).toBeUndefined();
    expect(paceToMps(undefined)).toBeUndefined();
  });
});

describe("buildWorkoutPayload (structured)", () => {
  it("emits warmup, a repeat group, and cooldown with resolved HR/power targets", () => {
    const p = buildWorkoutPayload({
      sport: "run",
      name: "Intervals",
      zones: { bike: { power: { ftp: 250, zones: [] } } } as any,
      structure: {
        warmup: [
          {
            type: "warmup",
            duration: { unit: "minutes", value: 10 },
            intensity: { unit: "hr_zone", valueLow: 110, valueHigh: 130 },
          },
        ],
        main: [
          {
            type: "interval_set",
            repeats: 5,
            steps: [
              {
                type: "work",
                duration: { unit: "minutes", value: 3 },
                intensity: { unit: "hr_zone", valueLow: 155, valueHigh: 170 },
              },
              {
                type: "recovery",
                duration: { unit: "minutes", value: 2 },
                intensity: { unit: "hr_zone", valueLow: 110, valueHigh: 130 },
              },
            ],
          },
          {
            type: "work",
            duration: { unit: "kilometers", value: 3 },
            intensity: { unit: "percent_ftp", valueLow: 88, valueHigh: 94 },
          },
        ],
        cooldown: [
          {
            type: "cooldown",
            duration: { unit: "minutes", value: 10 },
            intensity: { unit: "rpe", value: 2 },
          },
        ],
      },
    } as any) as any;

    const steps = p.workoutSegments[0].workoutSteps;
    expect(steps).toHaveLength(4);
    expect(steps[0].stepType.stepTypeKey).toBe("warmup");
    expect(steps[0].endConditionValue).toBe(600);

    const rg = steps[1];
    expect(rg.type).toBe("RepeatGroupDTO");
    expect(rg.numberOfIterations).toBe(5);
    expect(rg.workoutSteps).toHaveLength(2);
    expect(rg.workoutSteps[0].targetType.workoutTargetTypeKey).toBe("heart.rate.zone");
    expect(rg.workoutSteps[0].childStepId).toBe(rg.childStepId);

    const power = steps[2];
    expect(power.endCondition.conditionTypeKey).toBe("distance");
    expect(power.endConditionValue).toBe(3000);
    expect(power.targetType.workoutTargetTypeKey).toBe("power.zone");
    expect(power.targetValueOne).toBe(220); // 250 * 0.88
    expect(power.targetValueTwo).toBe(235); // 250 * 0.94

    expect(steps[3].stepType.stepTypeKey).toBe("cooldown");
    expect(steps[3].targetType.workoutTargetTypeKey).toBe("no.target"); // rpe → open
  });
});

describe("pushWorkouts", () => {
  let dir: string;
  let tokenFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gw-"));
    tokenFile = join(dir, "garmin_tokens.json");
    writeFileSync(tokenFile, JSON.stringify({ di_refresh_token: "r", di_client_id: "c" }));
    process.env.GARMINTOKENS = tokenFile;
  });
  afterEach(() => {
    delete process.env.GARMINTOKENS;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("dry-run builds payloads and makes no requests", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const out = await pushWorkouts([{ sport: "run", name: "X", durationMinutes: 20 }], {
      dryRun: true,
    });
    expect(out[0].dryRun).toBe(true);
    expect(out[0].payload).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
  });

  it("creates + schedules each dated workout live", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("diauth")) return res({ access_token: "a", refresh_token: "r2" });
        if (url.includes("/workout-service/workout")) return res({ workoutId: 999 });
        if (url.includes("/workout-service/schedule/")) return res({ workoutScheduleId: 555 });
        return res(null);
      })
    );
    const out = await pushWorkouts([
      { date: "2026-06-10", sport: "run", name: "X", durationMinutes: 20 },
    ]);
    expect(out[0].error).toBeUndefined();
    expect(out[0].workoutId).toBe(999);
    expect(out[0].scheduleId).toBe(555);
  });

  it("re-push UPDATES in place via the store (no duplicate)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("diauth")) return res({ access_token: "a", refresh_token: "r2" });
        if (url.includes("/workout-service/workouts?")) return res([]); // list: no name matches
        if (url.includes("/workout-service/workout")) return res({ workoutId: 777 });
        if (url.includes("/workout-service/schedule/")) return res({ workoutScheduleId: 42 });
        return res(null);
      })
    );
    const db = new Map<string, any>();
    const store = {
      lookup: (k: string) => db.get(k),
      save: (rec: any) => db.set(rec.push_key, rec),
    };
    const input = { date: "2026-06-11", sport: "run", name: "Easy", durationMinutes: 25 };

    const r1 = await pushWorkouts([input], { store });
    expect(r1[0].replaced).toBe(false);
    expect(r1[0].workoutId).toBe(777);

    const r2 = await pushWorkouts([input], { store });
    expect(r2[0].replaced).toBe(true); // found in store → updated in place
    expect(r2[0].workoutId).toBe(777);
    expect(calls.some((c) => c.startsWith("PUT "))).toBe(true); // second run PUTs, not POSTs
  });

  it("keys the store on input.key so a rename re-pushes in place (no orphan)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("diauth")) return res({ access_token: "a", refresh_token: "r2" });
        if (url.includes("/workout-service/workouts?")) return res([]);
        if (url.includes("/workout-service/workout")) return res({ workoutId: 777 });
        if (url.includes("/workout-service/schedule/")) return res({ workoutScheduleId: 42 });
        return res(null);
      })
    );
    const db = new Map<string, any>();
    const store = {
      lookup: (k: string) => db.get(k),
      save: (rec: any) => db.set(rec.push_key, rec),
    };
    const key = "2026-06-17|run#0";

    // First push under the stable key.
    await pushWorkouts([{ date: "2026-06-17", key, sport: "run", name: "3x8 tempo" }], { store });
    expect([...db.keys()]).toEqual([key]); // stored by key, not name

    // Rename the workout but keep the key → updates in place, store stays single-rowed.
    const r = await pushWorkouts([{ date: "2026-06-17", key, sport: "run", name: "2x12 tempo" }], {
      store,
    });
    expect(r[0].replaced).toBe(true);
    expect([...db.keys()]).toEqual([key]); // no second row → no orphan
    expect(db.get(key).name).toBe("2x12 tempo");
  });
});
