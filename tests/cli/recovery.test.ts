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
    expect(recoveryLevelFromScore(25)).toBe("low");
    expect(recoveryLevelFromScore(10)).toBe("poor");
  });
});

describe("recoveryFromAcwr", () => {
  it("scores low load as well-recovered and high load as recovery debt", () => {
    expect(recoveryFromAcwr(0.8)).toBeCloseTo(84.6, 1);
    expect(recoveryFromAcwr(1.0)).toBeCloseTo(77, 1);
    expect(recoveryFromAcwr(1.4)).toBeCloseTo(61.8, 1);
    expect(recoveryFromAcwr(2.0)).toBeCloseTo(39, 1);
    expect(recoveryFromAcwr(0.2)).toBe(100); // clamped
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
    expect(d.factors).toHaveLength(1);
  });

  it("reconstructs readiness from the real 2026-06-02 inputs (~63, high)", () => {
    // sleep 54 (w2) + recovery(ACWR 1.4→61.8, w2) + HRV(64 vs 66-78→60, w1.2) + stress(12→88, w1)
    const d = computeReadiness({
      sleepScore: 54,
      acwr: 1.4,
      hrvWeeklyAvg: 64,
      hrvBaselineLow: 66,
      hrvBaselineUpper: 78,
      avgStress: 12,
    })!;
    expect(d.score).toBe(63);
    expect(d.level).toBe("high");
    expect(d.factors.map((f) => f.name)).toEqual(["sleep", "recovery", "hrv", "stress"]);
  });

  it("scores HRV from the baseline band; below balanced lowers it", () => {
    const below = computeReadiness({ hrvWeeklyAvg: 64, hrvBaselineLow: 66, hrvBaselineUpper: 78 })!;
    const within = computeReadiness({
      hrvWeeklyAvg: 72,
      hrvBaselineLow: 66,
      hrvBaselineUpper: 78,
    })!;
    const above = computeReadiness({ hrvWeeklyAvg: 82, hrvBaselineLow: 66, hrvBaselineUpper: 78 })!;
    expect(below.score).toBeLessThan(within.score);
    expect(within.score).toBeLessThan(above.score);
    expect(within.score).toBe(80); // weeklyAvg at band midpoint -> anchor 80
  });

  it("falls back to HRV status label when no numeric baseline exists", () => {
    expect(computeReadiness({ hrvStatus: "balanced" })!.score).toBe(80);
    expect(computeReadiness({ hrvStatus: "low" })!.score).toBe(38);
    expect(computeReadiness({ hrvStatus: "LOW" })!.score).toBe(38); // case-insensitive
  });

  it("penalizes resting HR elevated above baseline (only with a baseline)", () => {
    const base = computeReadiness({ sleepScore: 70 })!;
    const elevated = computeReadiness({ sleepScore: 70, restingHr: 45, restingHrBaseline: 38 })!;
    expect(elevated.score).toBeLessThan(base.score);
    expect(elevated.factors.some((f) => f.name === "resting HR")).toBe(true);
  });

  it("does not penalize resting HR at/below baseline or without a baseline", () => {
    expect(computeReadiness({ sleepScore: 70, restingHr: 37, restingHrBaseline: 38 })!.score).toBe(
      70
    );
    expect(
      computeReadiness({ sleepScore: 70, restingHr: 55, restingHrBaseline: null })!.score
    ).toBe(70);
  });
});
