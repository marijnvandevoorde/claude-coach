import { describe, it, expect } from "vitest";
import {
  deriveRecovery,
  recoveryLevelFromScore,
  trainingStatusScore,
} from "../../src/lib/recovery.js";

describe("recoveryLevelFromScore", () => {
  it("maps scores to the readiness bands", () => {
    expect(recoveryLevelFromScore(90)).toBe("prime");
    expect(recoveryLevelFromScore(75)).toBe("prime");
    expect(recoveryLevelFromScore(60)).toBe("moderate");
    expect(recoveryLevelFromScore(50)).toBe("moderate");
    expect(recoveryLevelFromScore(40)).toBe("low");
    expect(recoveryLevelFromScore(25)).toBe("low");
    expect(recoveryLevelFromScore(10)).toBe("poor");
  });
});

describe("deriveRecovery", () => {
  it("returns null when no signals are present", () => {
    expect(deriveRecovery({})).toBeNull();
    expect(deriveRecovery({ bodyBattery: null, sleepScore: null, hrvStatus: null })).toBeNull();
  });

  it("uses body battery directly when it is the only signal", () => {
    const d = deriveRecovery({ bodyBattery: 80 });
    expect(d?.score).toBe(80);
    expect(d?.level).toBe("prime");
    expect(d?.components).toEqual(["body battery 80"]);
  });

  it("takes a weighted mean of multiple signals", () => {
    // bb 90 (w1.0) + sleepScore 70 (w0.8) -> (90 + 56)/1.8 = 81.1 -> 81
    const d = deriveRecovery({ bodyBattery: 90, sleepScore: 70 });
    expect(d?.score).toBe(81);
    expect(d?.level).toBe("prime");
  });

  it("scores HRV status on a balanced/unbalanced/low/poor scale", () => {
    expect(deriveRecovery({ hrvStatus: "balanced" })?.score).toBe(85);
    expect(deriveRecovery({ hrvStatus: "unbalanced" })?.score).toBe(55);
    expect(deriveRecovery({ hrvStatus: "low" })?.score).toBe(35);
    expect(deriveRecovery({ hrvStatus: "poor" })?.score).toBe(25);
    // case-insensitive; unknown labels fall back to a neutral 55
    expect(deriveRecovery({ hrvStatus: "BALANCED" })?.score).toBe(85);
    expect(deriveRecovery({ hrvStatus: "weird" })?.score).toBe(55);
  });

  it("normalizes sleep hours against an 8 h reference", () => {
    expect(deriveRecovery({ sleepHours: 8 })?.score).toBe(100);
    expect(deriveRecovery({ sleepHours: 4 })?.score).toBe(50);
    expect(deriveRecovery({ sleepHours: 10 })?.score).toBe(100); // clamped
  });

  it("penalizes resting HR elevated above baseline (only with a baseline)", () => {
    const base = deriveRecovery({ bodyBattery: 80 })!;
    const elevated = deriveRecovery({ bodyBattery: 80, restingHr: 45, restingHrBaseline: 38 })!;
    expect(elevated.score).toBeLessThan(base.score);
    expect(elevated.components.some((c) => c.includes("resting HR"))).toBe(true);
  });

  it("does not penalize when resting HR is at/below baseline", () => {
    const d = deriveRecovery({ bodyBattery: 80, restingHr: 37, restingHrBaseline: 38 })!;
    expect(d.score).toBe(80);
    expect(d.components.some((c) => c.includes("resting HR"))).toBe(false);
  });

  it("ignores resting HR when no baseline is available yet", () => {
    const d = deriveRecovery({ bodyBattery: 80, restingHr: 55, restingHrBaseline: null })!;
    expect(d.score).toBe(80);
  });

  it("folds Garmin training status into the score and lowers it when strained", () => {
    const without = deriveRecovery({ bodyBattery: 89, sleepScore: 54, hrvStatus: "low" })!;
    const strained = deriveRecovery({
      bodyBattery: 89,
      sleepScore: 54,
      hrvStatus: "low",
      trainingStatus: "Strained 5",
    })!;
    expect(strained.score).toBeLessThan(without.score);
    expect(strained.components.some((c) => c.includes("training status Strained 5"))).toBe(true);
  });

  it("raises the score for a productive status and skips unknown labels", () => {
    const productive = deriveRecovery({ bodyBattery: 60, trainingStatus: "Productive 8" })!;
    expect(productive.score).toBeGreaterThan(60); // 80 pulls the 60 up
    const noStatus = deriveRecovery({ bodyBattery: 60, trainingStatus: "No Status" })!;
    expect(noStatus.score).toBe(60); // unknown -> ignored
  });
});

describe("trainingStatusScore", () => {
  it("scores the leading status word, ignoring the trailing number", () => {
    expect(trainingStatusScore("Strained 5")).toBe(30);
    expect(trainingStatusScore("Unproductive 3")).toBe(40);
    expect(trainingStatusScore("Productive 8")).toBe(80);
    expect(trainingStatusScore("Peaking 9")).toBe(90);
    expect(trainingStatusScore("Recovery 2")).toBe(70);
  });

  it("returns null for unknown / empty labels", () => {
    expect(trainingStatusScore("No Status")).toBeNull();
    expect(trainingStatusScore("")).toBeNull();
    expect(trainingStatusScore("12345")).toBeNull();
  });
});
