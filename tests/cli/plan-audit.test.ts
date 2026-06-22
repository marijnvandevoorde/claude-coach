import { describe, it, expect } from "vitest";
import { computeGoalAnchor } from "../../src/lib/goalAnchor.js";
import { auditPlan } from "../../src/lib/planAudit.js";
import { periodize, type PeriodizerInput } from "../../src/lib/periodizer.js";
import type { FitnessSnapshot } from "../../src/lib/fitness.js";

// goalAnchor + planAudit — the read-time anchor and the save-gate soundness
// audit. The "healthy plan" fixture is a real periodizer skeleton, so these also
// assert the periodizer's own output passes its audit (the airlock is consistent).

function fit(): FitnessSnapshot {
  return {
    asOf: "2026-06-22",
    weeksObserved: 10,
    weeks: [],
    recentWeeklyEFD: 45,
    recentWeeklyDPlus: 700,
    peakWeeklyEFD: 50,
    longestRunEFD: 26,
    weeklyRunSessions: 4,
    efdTrend: "flat",
    foundation: "intermediate",
  };
}

const goal = {
  distance_km: 45,
  elevation_gain_m: 1450,
  event_date: "2026-09-13",
  updated_at: "2026-06-01T00:00:00Z",
};

const input: PeriodizerInput = {
  goal: {
    id: "g1",
    name: "Hautes Fagnes",
    eventDate: "2026-09-13",
    distanceKm: 45,
    dPlusM: 1450,
    eventType: "trail",
  },
  fitness: fit(),
  availability: { days: ["tue", "thu", "sat", "sun"], weeklyHours: 7, longDay: "sat" },
  asOf: "2026-06-22",
};
const skeleton = periodize(input);
// Shape the skeleton like a stored plan for the anchor/audit (meta + weeks).
const planLike = {
  meta: {
    goalId: "g1",
    updatedAt: "2026-06-22T10:00:00Z",
    eventDate: "2026-09-13",
    totalWeeks: skeleton.meta.totalWeeks,
  },
  weeks: skeleton.weeks,
};

describe("goalAnchor", () => {
  it("returns no-plan when there is no plan", () => {
    expect(computeGoalAnchor(null, goal, "2026-06-22").status).toBe("no-plan");
  });

  it("flags orphaned when the bound goal no longer resolves", () => {
    const a = computeGoalAnchor(planLike, null, "2026-06-22");
    expect(a.status).toBe("orphaned");
    expect(a.detail).toContain("g1");
  });

  it("flags stale when the goal was edited after the plan was built", () => {
    const a = computeGoalAnchor(
      planLike,
      { ...goal, updated_at: "2026-07-01T00:00:00Z" },
      "2026-06-22"
    );
    expect(a.status).toBe("stale");
  });

  it("is on-track for a sound plan and reports the countdown + plan week", () => {
    const a = computeGoalAnchor(planLike, goal, "2026-06-22");
    expect(a.status).toBe("on-track");
    expect(a.weeksToGoal).toBe(12);
    expect(a.currentWeek).toBe(1);
    expect(a.peakPctOfRace).toBeGreaterThanOrEqual(0.65);
  });

  it("flags behind when the peak long run is under-built", () => {
    const shallow = {
      ...planLike,
      weeks: planLike.weeks.map((w) => ({ ...w, longRunEFD: Math.min(w.longRunEFD, 20) })),
    };
    expect(computeGoalAnchor(shallow, goal, "2026-06-22").status).toBe("behind");
  });
});

describe("planAudit", () => {
  it("passes a real periodizer skeleton with no error findings", () => {
    const res = auditPlan(planLike, { goal, foundation: "intermediate" });
    expect(res.checked).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.findings.some((f) => f.code === "ramp-spike")).toBe(false);
    expect(res.findings.some((f) => f.code === "no-taper")).toBe(false);
    expect(res.findings.some((f) => f.code === "no-deload")).toBe(false);
  });

  it("reports checked:false for a plan carrying no EFD envelope", () => {
    const res = auditPlan({ weeks: [{ weekNumber: 1, phase: "Base" }] });
    expect(res.checked).toBe(false);
    expect(res.ok).toBe(true);
  });

  it("errors on an orphaned goal", () => {
    const res = auditPlan({ meta: { goalId: "ghost" }, weeks: planLike.weeks }, { goal: null });
    expect(res.ok).toBe(false);
    expect(res.findings.some((f) => f.code === "orphan-goal")).toBe(true);
  });

  it("errors on a ramp spike", () => {
    const spiked = {
      weeks: [
        { weekNumber: 1, phase: "Base", targetEFD: 30, targetDPlus: 400, isRecoveryWeek: false },
        { weekNumber: 2, phase: "Base", targetEFD: 55, targetDPlus: 900, isRecoveryWeek: false },
      ],
    };
    const res = auditPlan(spiked, { foundation: "intermediate" });
    expect(res.ok).toBe(false);
    expect(res.findings.some((f) => f.code === "ramp-spike")).toBe(true);
  });

  it("warns on a missing taper and missing deloads over a long build", () => {
    const weeks = Array.from({ length: 8 }, (_, i) => ({
      weekNumber: i + 1,
      phase: "Base",
      targetEFD: 30 + i * 2,
      targetDPlus: 400 + i * 30,
      longRunEFD: 15 + i,
      isRecoveryWeek: false,
    }));
    const res = auditPlan({ weeks }, { goal, foundation: "intermediate" });
    expect(res.findings.some((f) => f.code === "no-taper")).toBe(true);
    expect(res.findings.some((f) => f.code === "no-deload")).toBe(true);
    expect(res.findings.some((f) => f.code === "long-run-short")).toBe(true);
  });
});
