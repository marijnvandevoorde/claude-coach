import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkoutPayload, pushWorkouts } from "../../src/garmin/workouts.js";

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
});
