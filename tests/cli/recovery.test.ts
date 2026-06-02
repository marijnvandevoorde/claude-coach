import { describe, it, expect } from "vitest";
import {
  computeReadiness,
  recoveryFromAcwr,
  recoveryLevelFromScore,
} from "../../src/lib/recovery.js";

describe("recoveryLevelFromScore", () => {
  it("maps scores to Garmin's five labels", () => {
    expect(recoveryLevelFromScore(90)).toBe("prime");
    expect(recoveryLevelFromScore(75)).toBe("prime");
    expect(recoveryLevelFromScore(63)).toBe("high");
    expect(recoveryLevelFromScore(55)).toBe("high");
    expect(recoveryLevelFromScore(50)).toBe("moderate");
    expect(recoveryLevelFromScore(40)).toBe("moderate");
    expect(recoveryLevelFromScore(30)).toBe("low");
    expect(recoveryLevelFromScore(10)).toBe("poor");
  });
});

describe("recoveryFromAcwr (Garmin 0.8–1.3 sweet spot)", () => {
  it("scores the sweet spot high and penalizes spikes, not the normal zone", () => {
    expect(recoveryFromAcwr(1.0)).toBe(90); // mid sweet spot
    expect(recoveryFromAcwr(1.2)).toBe(90); // still in sweet spot
    expect(recoveryFromAcwr(0.8)).toBe(90); // lower edge
    expect(recoveryFromAcwr(1.5)).toBeCloseTo(79, 0); // danger threshold
    expect(recoveryFromAcwr(2.0)).toBeCloseTo(51.5, 1); // big spike
  });
  it("treats a very low ratio as recovered-but-undertrained, not prime", () => {
    expect(recoveryFromAcwr(0.5)).toBe(70); // not 100 — undertraining isn't "ready"
  });
});

describe("computeReadiness", () => {
  it("returns null when no signals are present", () => {
    expect(computeReadiness({})).toBeNull();
  });

  it("uses sleep score directly when it's the only signal", () => {
    const d = computeReadiness({ sleepScore: 80 })!;
    expect(d.score).toBe(80);
    expect(d.level).toBe("prime");
  });

  it("reconstructs readiness from the real 2026-06-02 inputs", () => {
    // sleep 54 (w2) + recovery(ACWR 1.4→84.5, w1.2) + HRV(64 vs 66-78→67, w1.2) + stress(12→88, w0.5)
    const d = computeReadiness({
      sleepScore: 54,
      acwr: 1.4,
      hrvWeeklyAvg: 64,
      hrvBaselineLow: 66,
      hrvBaselineUpper: 78,
      avgStress: 12,
    })!;
    expect(d.score).toBeGreaterThanOrEqual(65);
    expect(d.score).toBeLessThanOrEqual(71);
    expect(d.level).toBe("high");
    expect(d.factors.map((f) => f.name)).toEqual(["sleep", "recovery", "hrv", "stress"]);
  });

  it("scores HRV against the baseline band: flat inside, penalized below", () => {
    const below = computeReadiness({ hrvWeeklyAvg: 60, hrvBaselineLow: 66, hrvBaselineUpper: 78 })!;
    const atFloor = computeReadiness({
      hrvWeeklyAvg: 66,
      hrvBaselineLow: 66,
      hrvBaselineUpper: 78,
    })!;
    const above = computeReadiness({ hrvWeeklyAvg: 82, hrvBaselineLow: 66, hrvBaselineUpper: 78 })!;
    expect(atFloor.score).toBe(75); // at the band floor
    expect(below.score).toBeLessThan(75);
    expect(above.score).toBeGreaterThan(75);
  });

  it("falls back to HRV status label when no numeric baseline exists", () => {
    expect(computeReadiness({ hrvStatus: "balanced" })!.score).toBe(80);
    expect(computeReadiness({ hrvStatus: "low" })!.score).toBe(38);
    expect(computeReadiness({ hrvStatus: "LOW" })!.score).toBe(38);
  });

  it("incorporates subjective wellness when logged", () => {
    const objectiveOnly = computeReadiness({ sleepScore: 70, acwr: 1.0 })!;
    const withGoodSubjective = computeReadiness({
      sleepScore: 70,
      acwr: 1.0,
      energy: 5,
      soreness: 1,
      mood: 5,
    })!;
    expect(withGoodSubjective.factors.some((f) => f.name === "subjective")).toBe(true);
    expect(withGoodSubjective.score).toBeGreaterThan(objectiveOnly.score);
  });

  it("caps an optimistic objective score when subjective is clearly bad", () => {
    const d = computeReadiness({
      sleepScore: 90,
      acwr: 1.0, // objective would be prime/high
      energy: 1, // but the athlete feels wrecked
    })!;
    expect(d.score).toBe(54); // capped at top of moderate
    expect(d.level).toBe("moderate");
    expect(d.cappedBySubjective).toBe(true);
  });

  it("penalizes resting HR only at >=5 bpm over baseline", () => {
    const noPenalty = computeReadiness({ sleepScore: 70, restingHr: 41, restingHrBaseline: 38 })!; // +3
    const penalty = computeReadiness({ sleepScore: 70, restingHr: 45, restingHrBaseline: 38 })!; // +7
    expect(noPenalty.score).toBe(70); // +3 is within noise — no penalty now
    expect(penalty.score).toBeLessThan(70);
    expect(penalty.factors.some((f) => f.name === "resting HR")).toBe(true);
  });
});
