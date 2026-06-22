import { describe, it, expect } from "vitest";
import { judgeSession, reclassify, sessionCategory } from "../../src/lib/sessionAdherence.js";
import { reconcile, type PrescribedItem, type ActualActivity } from "../../src/lib/planActual.js";
import { detectDrift } from "../../src/lib/planDrift.js";

// The adaptive loop's pure core: HR-lag-aware adherence judging, prescription↔
// actual matching, and the too-tired/too-easy drift verdict.

describe("sessionAdherence — HR-lag-aware judging", () => {
  it("categorizes sessions by the signal that's valid for them", () => {
    expect(sessionCategory({ sport: "run", type: "intervals" })).toBe("short-interval");
    expect(sessionCategory({ sport: "run", type: "threshold" })).toBe("threshold");
    expect(sessionCategory({ sport: "run", type: "long" })).toBe("steady-long");
    expect(sessionCategory({ sport: "run", type: "easy" })).toBe("easy");
    expect(sessionCategory({ sport: "run", type: "hills" })).toBe("hills");
  });

  it("does NOT fail a long run on high avg HR (drift is expected)", () => {
    const v = judgeSession(
      { sport: "run", type: "long", durationMinutes: 120, primaryZone: "Z2" },
      { sport: "Run", movingMin: 122, distanceKm: 22, dPlusM: 600, avgHr: 162 }
    );
    expect(v.class).toBe("on-target");
    expect(v.judgedBy).toBe("duration"); // not hr
    expect(v.isOutlier).toBe(false);
  });

  it("flags a cut-short interval session on work done, not HR", () => {
    const v = judgeSession(
      { sport: "run", type: "intervals", durationMinutes: 60, hasStructure: true },
      { sport: "Run", movingMin: 38, distanceKm: 8, dPlusM: 100, avgHr: 150 }
    );
    expect(v.class).toBe("cut-short");
    expect(v.isOutlier).toBe(true);
    expect(v.questionToAsk).toBeTruthy();
  });

  it("asks to confirm a quality session it can't verify from HR (lag), not fail it", () => {
    const v = judgeSession(
      { sport: "run", type: "vo2max", durationMinutes: 45, hasStructure: true },
      { sport: "Run", movingMin: 46, distanceKm: 9, dPlusM: 120, avgHr: 150 }
    );
    expect(v.class).toBe("on-target"); // volume fine
    expect(v.confidence).toBe("low"); // HR can't confirm the rep effort
    expect(v.questionToAsk).toMatch(/pace|power|effort/i);
  });

  it("routes implausible data to data-glitch, and a missing actual to unmatched", () => {
    expect(
      judgeSession(
        { sport: "run", type: "easy", durationMinutes: 40 },
        {
          sport: "Run",
          movingMin: 40,
          distanceKm: 8,
          dPlusM: 50,
          avgHr: 240,
        }
      ).class
    ).toBe("data-glitch");
    expect(judgeSession({ sport: "run", type: "easy", durationMinutes: 40 }, null).class).toBe(
      "unmatched"
    );
  });

  it("reclassify applies athlete feedback and clears the outlier flag", () => {
    const v = judgeSession(
      { sport: "run", type: "intervals", durationMinutes: 60, hasStructure: true },
      { sport: "Run", movingMin: 38, distanceKm: 8, dPlusM: 100 }
    );
    const r = reclassify(v, "legit-hard");
    expect(r.class).toBe("legit-hard");
    expect(r.isOutlier).toBe(false);
  });
});

describe("planActual — prescription↔actual matching", () => {
  const prescribed: PrescribedItem[] = [
    {
      key: "2026-06-20|run#0",
      date: "2026-06-20",
      sport: "run",
      type: "long",
      durationMinutes: 120,
      name: "Long run",
    },
    {
      key: "2026-06-20|run#1",
      date: "2026-06-20",
      sport: "run",
      type: "easy",
      durationMinutes: 40,
      name: "Easy shakeout",
    },
    {
      key: "2026-06-22|run#0",
      date: "2026-06-22",
      sport: "run",
      type: "intervals",
      durationMinutes: 60,
      name: "Intervals",
      hasStructure: true,
    },
  ];
  const actuals: ActualActivity[] = [
    { id: 1, date: "2026-06-20", sport: "Run", movingMin: 41, distanceKm: 8, dPlusM: 80 }, // the easy one
    { id: 2, date: "2026-06-20", sport: "TrailRun", movingMin: 118, distanceKm: 22, dPlusM: 700 }, // the long one
    { id: 3, date: "2026-06-23", sport: "Run", movingMin: 50, distanceKm: 10, dPlusM: 150 }, // unplanned (wrong day)
  ];

  it("matches long→long and easy→easy within a day (biggest-first)", () => {
    const r = reconcile(prescribed, actuals, { from: "2026-06-15", to: "2026-06-25" });
    const long = r.matched.find((m) => m.key === "2026-06-20|run#0");
    const easy = r.matched.find((m) => m.key === "2026-06-20|run#1");
    expect(long?.activityId).toBe(2); // the 118-min trail run
    expect(easy?.activityId).toBe(1); // the 41-min shakeout
  });

  it("reports a missed prescription and an unplanned activity, with questions", () => {
    const r = reconcile(prescribed, actuals, { from: "2026-06-15", to: "2026-06-25" });
    expect(r.missed.some((m) => m.key === "2026-06-22|run#0")).toBe(true); // intervals had no actual
    expect(r.unplanned.some((u) => u.activityId === 3)).toBe(true);
    expect(r.questions.length).toBeGreaterThan(0);
    expect(r.summary.matched).toBe(2);
    expect(r.summary.missed).toBe(1);
  });
});

describe("planDrift — too-tired / too-easy detection", () => {
  it("fires too-tired on a multi-day readiness + ACWR pattern", () => {
    const v = detectDrift({ readinessLowDays: 3, acwr: 1.6, cutShort: 2 });
    expect(v.status).toBe("too-tired");
    expect(v.suggestion).toBe("flatten"); // ACWR ≥1.5
    expect(v.confidence).toBe("high");
  });

  it("fires too-easy only on a clear sustained over-performance pattern", () => {
    const v = detectDrift({
      overCooked: 3,
      readinessAvg: 80,
      acwr: 0.8,
      actualVsEnvelope: 1.2,
      onTarget: 4,
    });
    expect(v.status).toBe("too-easy");
    expect(v.suggestion).toBe("ramp-up");
  });

  it("holds on-track with no pattern, and mixed when signals conflict", () => {
    expect(detectDrift({ onTarget: 3, acwr: 1.1 }).status).toBe("on-track");
    const mixed = detectDrift({
      readinessLowDays: 2,
      acwr: 1.6,
      overCooked: 3,
      readinessAvg: 75,
      actualVsEnvelope: 1.2,
    });
    expect(mixed.status).toBe("mixed");
    expect(mixed.suggestion).toBe("hold");
  });

  it("does not fire too-easy on a single good signal (conservative to push)", () => {
    expect(detectDrift({ overCooked: 2 }).status).toBe("on-track");
  });
});
