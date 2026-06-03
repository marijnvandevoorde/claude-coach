import { describe, it, expect } from "vitest";
import {
  computeReadiness,
  recoveryFromAcwr,
  recoveryLevelFromScore,
  readinessContributions,
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

  it("scores HRV via the LnRMSSD / SWC band: ~80 inside, penalized when suppressed", () => {
    const mean = 3.9; // ln(RMSSD) baseline
    const sd = 0.2; // SWC = 0.1
    const normal = computeReadiness({ hrvLnRmssd: mean, hrvLnRmssdMean: mean, hrvLnRmssdSd: sd })!;
    const suppressed = computeReadiness({
      hrvLnRmssd: mean - 0.2, // −2 SWC
      hrvLnRmssdMean: mean,
      hrvLnRmssdSd: sd,
    })!;
    const elevated = computeReadiness({
      hrvLnRmssd: mean + 0.2, // +2 SWC
      hrvLnRmssdMean: mean,
      hrvLnRmssdSd: sd,
    })!;
    expect(normal.score).toBe(80); // inside the band → no meaningful change
    expect(suppressed.score).toBe(44); // 80 − 2·18
    expect(elevated.score).toBe(92); // 80 + 2·6 (capped)
    expect(normal.factors[0].detail).toContain("lnRMSSD");
  });

  it("prefers the LnRMSSD/SWC path over the Garmin weekly-avg band when both exist", () => {
    // weeklyAvg below the band would score <75; the LnRMSSD path (dev 0) wins at 80.
    const d = computeReadiness({
      hrvLnRmssd: 3.9,
      hrvLnRmssdMean: 3.9,
      hrvLnRmssdSd: 0.2,
      hrvWeeklyAvg: 60,
      hrvBaselineLow: 66,
      hrvBaselineUpper: 78,
    })!;
    const hrv = d.factors.find((f) => f.name === "hrv")!;
    expect(hrv.score).toBe(80);
    expect(hrv.detail).toContain("lnRMSSD");
  });

  it("adds a sleep-regularity factor: tight timing high, irregular low", () => {
    const tight = computeReadiness({ sleepScore: 70, sleepRegularityMinutes: 20 })!;
    const irregular = computeReadiness({ sleepScore: 70, sleepRegularityMinutes: 120 })!;
    const tReg = tight.factors.find((f) => f.name === "sleep regularity")!;
    const iReg = irregular.factors.find((f) => f.name === "sleep regularity")!;
    expect(tReg.score).toBe(100); // ≤30 min SD → fully regular
    expect(iReg.score).toBe(30); // ±120 min SD → poor regularity
    expect(tight.score).toBeGreaterThan(irregular.score);
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

describe("readinessContributions", () => {
  it("collapses the three sleep factors into one Sleep contribution", () => {
    const { contributions } = readinessContributions({
      sleepScore: 80,
      sleepHistoryScore: 75,
      sleepRegularityMinutes: 20,
      acwr: 1.0,
    });
    const sleep = contributions.filter((c) => c.key === "sleep");
    expect(sleep.length).toBe(1);
    expect(sleep[0].label).toBe("Sleep");
  });

  it("maps factor names to the five athlete-facing inputs", () => {
    const { contributions } = readinessContributions({
      sleepScore: 70,
      acwr: 1.0,
      hrvStatus: "balanced",
      avgStress: 20,
      energy: 4,
      mood: 4,
    });
    const keys = new Set(contributions.map((c) => c.key));
    expect(keys).toEqual(new Set(["sleep", "load", "hrv", "stress", "subjective"]));
    for (const c of contributions) {
      expect(["Sleep", "HRV", "Training load", "Stress", "Subjective"]).toContain(c.label);
    }
  });

  it("signs points: a good day is positive, a bad day negative", () => {
    const good = readinessContributions({ sleepScore: 95 });
    const bad = readinessContributions({ sleepScore: 30 });
    expect(good.contributions[0].points).toBeGreaterThan(0);
    expect(bad.contributions[0].points).toBeLessThan(0);
    // ~±17 range, not summing to the score.
    expect(Math.abs(good.contributions[0].points)).toBeLessThanOrEqual(20);
  });

  it("reports per-input coverage from the raw signals", () => {
    const { coverage } = readinessContributions({
      sleepScore: 80,
      energy: 3,
    });
    expect(coverage.sleep).toBe(true);
    expect(coverage.subjective).toBe(true);
    expect(coverage.hrv).toBe(false);
    expect(coverage.load).toBe(false);
    expect(coverage.stress).toBe(false);
  });

  it("returns empty contributions but real coverage when no factor scores", () => {
    const { contributions, coverage } = readinessContributions({});
    expect(contributions).toEqual([]);
    expect(coverage).toEqual({
      sleep: false,
      hrv: false,
      load: false,
      stress: false,
      subjective: false,
    });
  });
});
