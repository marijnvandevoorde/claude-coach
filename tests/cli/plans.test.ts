import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { TrainingPlan } from "../../src/schema/training-plan.js";

// Minimal plan: a 3-day week where the middle day is a rest day. Cast through
// unknown since savePlan only reads meta + serializes the whole blob.
function makePlan(id: string, dates: string[]): TrainingPlan {
  return {
    version: "1.0",
    meta: {
      id,
      athlete: "Marijn",
      event: "Trail 50k",
      eventDate: "2026-09-01",
      planStartDate: dates[0],
      planEndDate: dates[dates.length - 1],
      createdAt: "",
      updatedAt: "",
      totalWeeks: 1,
      generatedBy: "test",
    },
    weeks: [
      {
        weekNumber: 1,
        days: dates.map((d, i) => ({
          date: d,
          dayOfWeek: "Mon",
          workouts:
            i === 1
              ? [{ sport: "rest", name: "Rest" }]
              : [
                  {
                    sport: "run",
                    type: "easy",
                    name: `Run ${d}`,
                    durationMinutes: 40,
                    primaryZone: "z2",
                  },
                ],
        })),
      },
    ],
  } as unknown as TrainingPlan;
}

describe("training plans data layer", () => {
  let home: string;
  let plans: typeof import("../../src/db/plans.js");

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-plans-"));
    process.env.HOME = home;
    const client = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    plans = await import("../../src/db/plans.js");
    await client.initDatabase();
    await migrate(true);
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("saves, activates, lists, and reads back the active plan", async () => {
    await plans.savePlan(makePlan("p1", ["2026-06-04", "2026-06-05", "2026-06-06"]));
    expect((await plans.getActivePlan())?.meta.id).toBe("p1");
    const list = await plans.listPlans();
    expect(list.find((p) => p.id === "p1")?.active).toBe(1);
  });

  it("keeps at most one plan active", async () => {
    await plans.savePlan(makePlan("p2", ["2026-07-01", "2026-07-02", "2026-07-03"]));
    expect((await plans.getActivePlan())?.meta.id).toBe("p2");
    expect((await plans.listPlans()).filter((p) => p.active === 1).length).toBe(1);
    await plans.setActivePlan("p1");
    expect((await plans.getActivePlan())?.meta.id).toBe("p1");
  });

  it("derives today's sessions and upcoming (rest days dropped)", () => {
    const plan = makePlan("p3", ["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(plans.sessionsForDate(plan, "2026-08-01").map((s) => s.sport)).toEqual(["run"]);
    expect(plans.sessionsForDate(plan, "2026-08-02")).toEqual([]); // rest day
    expect(plans.upcomingWorkouts(plan, "2026-08-02").map((s) => s.date)).toEqual(["2026-08-03"]);
  });

  it("deletes a plan", async () => {
    await plans.deletePlan("p2");
    expect(await plans.getPlan("p2")).toBeNull();
  });
});
