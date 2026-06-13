import { describe, it, expect } from "vitest";
import {
  workoutKey,
  keyedPlanWorkouts,
  sessionsForDate,
  upcomingWorkouts,
} from "../../src/db/plans.js";

describe("workoutKey", () => {
  it("prefers the canonical workout id when present", () => {
    expect(workoutKey("2026-06-17", { id: "w3-thu-tempo", sport: "run" }, 0)).toBe(
      "2026-06-17|w3-thu-tempo"
    );
    // id wins regardless of ordinal/sport
    expect(workoutKey("2026-06-17", { id: " w3-thu-tempo ", sport: "swim" }, 5)).toBe(
      "2026-06-17|w3-thu-tempo"
    );
  });

  it("falls back to date|sport#ordinal when there is no id", () => {
    expect(workoutKey("2026-06-17", { sport: "run" }, 0)).toBe("2026-06-17|run#0");
    expect(workoutKey("2026-06-17", { sport: "run" }, 1)).toBe("2026-06-17|run#1");
  });
});

describe("keyedPlanWorkouts (rename stability + multi-session days)", () => {
  // Flat-shape plan (no canonical ids) — the shape real plans use.
  const flat = (title: string) => ({
    weeks: [
      {
        days: [
          {
            date: "2026-06-17",
            workouts: [{ sport: "run", type: "tempo", title, distanceKm: 14 }],
          },
        ],
      },
    ],
  });

  it("a rename does NOT change the key", () => {
    const before = keyedPlanWorkouts(flat("Tempo 14 km (3x8 min @ threshold)") as any);
    const after = keyedPlanWorkouts(flat("Tempo 14 km (2x12 min @ threshold)") as any);
    expect(before[0].key).toBe("2026-06-17|run#0");
    expect(after[0].key).toBe(before[0].key); // same slot → updates in place, no orphan
  });

  it("distinguishes two same-sport sessions on one day", () => {
    const plan = {
      weeks: [
        {
          days: [
            {
              date: "2026-06-20",
              workouts: [
                { sport: "run", name: "AM shakeout" },
                { sport: "rest", name: "Rest" }, // own bucket — must not shift the PM run
                { sport: "run", name: "PM long" },
              ],
            },
          ],
        },
      ],
    };
    const keys = keyedPlanWorkouts(plan as any).map((k) => k.key);
    expect(keys).toEqual(["2026-06-20|run#0", "2026-06-20|run#1"]);
  });

  it("keys two different sports on one day independently", () => {
    const plan = {
      weeks: [
        {
          days: [
            {
              date: "2026-06-20",
              workouts: [
                { sport: "swim", name: "AM swim" },
                { sport: "bike", name: "PM ride" },
              ],
            },
          ],
        },
      ],
    };
    expect(keyedPlanWorkouts(plan as any).map((k) => k.key)).toEqual([
      "2026-06-20|swim#0",
      "2026-06-20|bike#0",
    ]);
  });
});

describe("session builders carry the key", () => {
  const plan = {
    workouts: [
      { date: "2026-06-17", sport: "run", type: "tempo", title: "Tempo", distanceKm: 14 },
      { date: "2026-06-20", sport: "run", type: "long_run", title: "Long", distanceKm: 34 },
    ],
  };

  it("sessionsForDate attaches the stable key", () => {
    const [s] = sessionsForDate(plan as any, "2026-06-17");
    expect(s.key).toBe("2026-06-17|run#0");
  });

  it("upcomingWorkouts attaches keys matching keyedPlanWorkouts", () => {
    const sessions = upcomingWorkouts(plan as any, "2026-06-01");
    expect(sessions.map((s) => s.key)).toEqual(["2026-06-17|run#0", "2026-06-20|run#0"]);
  });
});
