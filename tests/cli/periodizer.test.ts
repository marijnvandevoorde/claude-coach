import { describe, it, expect } from "vitest";
import {
  efd,
  efdFromMeters,
  dPlusTier,
  rampCap,
  maxWeeklyStep,
  isRampSafe,
} from "../../src/lib/loadModel.js";
import {
  computeFitnessSnapshot,
  sportFamily,
  weekStartOf,
  type ActivitySample,
  type FitnessSnapshot,
} from "../../src/lib/fitness.js";
import { periodize, type PeriodizerInput } from "../../src/lib/periodizer.js";

// Pure periodizer chain — no DB. loadModel + fitness + periodizer are the "code
// owns the numbers" core; these pin the cited heuristics (EFD, ramp caps, 3:1
// deloads, 70–80% long-run anchor, taper).

describe("loadModel — EFD + ramp primitives", () => {
  it("efd = distance + (D+/100)·k, default k=1.0", () => {
    expect(efd(45, 1450)).toBe(59.5);
    expect(efd(45, 1450, 1.2)).toBe(62.4);
    expect(efd(10)).toBe(10);
    expect(efd(-5, -100)).toBe(0); // floored
    expect(efdFromMeters(10000, 250)).toBe(12.5);
  });

  it("dPlusTier buckets weekly vert", () => {
    expect(dPlusTier(200)).toBe("flat");
    expect(dPlusTier(500)).toBe("moderate");
    expect(dPlusTier(1000)).toBe("hilly");
    expect(dPlusTier(2000)).toBe("mountain");
    expect(dPlusTier(3500)).toBe("alpine");
  });

  it("ramp caps tighten for weaker foundations; D+ ramps below EFD", () => {
    expect(rampCap("beginner").efd).toBeLessThan(rampCap("advanced").efd);
    expect(rampCap("intermediate").dPlus).toBeLessThanOrEqual(rampCap("intermediate").efd);
    const step = maxWeeklyStep({ efd: 40, dPlus: 800 }, "intermediate");
    expect(step.efd).toBe(4); // 10% of 40
    expect(step.dPlus).toBe(80);
  });

  it("isRampSafe accepts a normal step, rejects a spike, tolerates post-deload rebound", () => {
    expect(isRampSafe({ efd: 40, dPlus: 800 }, { efd: 44, dPlus: 880 }, "intermediate")).toBe(true);
    expect(isRampSafe({ efd: 40, dPlus: 800 }, { efd: 60, dPlus: 1200 }, "intermediate")).toBe(
      false
    );
    // a step within the 25% tolerance band is allowed
    expect(isRampSafe({ efd: 28, dPlus: 500 }, { efd: 31, dPlus: 555 }, "intermediate")).toBe(true);
  });
});

describe("fitness — snapshot rollups", () => {
  it("normalizes sport families and finds the Monday week start", () => {
    expect(sportFamily("TrailRun")).toBe("run");
    expect(sportFamily("VirtualRide")).toBe("bike");
    const ws = weekStartOf("2026-06-24"); // a Wednesday
    expect(new Date(`${ws}T00:00:00Z`).getUTCDay()).toBe(1); // Monday
    expect(ws).toBe("2026-06-22");
  });

  it("rolls weekly EFD/D+ and infers a foundation from consistent history", () => {
    // 10 complete weeks, 4 runs/week incl. a long run — a consistent base.
    const samples: ActivitySample[] = [];
    for (let w = 1; w <= 10; w++) {
      const monday = new Date(Date.UTC(2026, 3, 6)); // 2026-04-06 Monday
      monday.setUTCDate(monday.getUTCDate() + (w - 1) * 7);
      const iso = (off: number) => {
        const d = new Date(monday);
        d.setUTCDate(d.getUTCDate() + off);
        return d.toISOString().slice(0, 10);
      };
      samples.push({ date: iso(1), sport: "Run", distanceKm: 10, dPlusM: 200, movingMin: 55 });
      samples.push({ date: iso(3), sport: "Run", distanceKm: 12, dPlusM: 250, movingMin: 66 });
      samples.push({
        date: iso(5),
        sport: "TrailRun",
        distanceKm: 22,
        dPlusM: 700,
        movingMin: 140,
      });
      samples.push({ date: iso(6), sport: "Run", distanceKm: 8, dPlusM: 150, movingMin: 44 });
    }
    const snap = computeFitnessSnapshot(samples, "2026-06-22");
    expect(snap.weeksObserved).toBeGreaterThanOrEqual(8);
    expect(snap.recentWeeklyEFD).toBeGreaterThan(40);
    expect(snap.longestRunEFD).toBeGreaterThan(25); // the 22km/700m trail run
    expect(["intermediate", "advanced"]).toContain(snap.foundation);
  });
});

function fitFixture(over: Partial<FitnessSnapshot> = {}): FitnessSnapshot {
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
    ...over,
  };
}

const avail = { days: ["tue", "thu", "sat", "sun"], weeklyHours: 7, longDay: "sat" } as const;

describe("periodizer — ramp-safe skeleton", () => {
  const input: PeriodizerInput = {
    goal: {
      id: "g1",
      name: "Trail des Hautes Fagnes",
      eventDate: "2026-09-13",
      distanceKm: 45,
      dPlusM: 1450,
      eventType: "trail",
    },
    fitness: fitFixture(),
    availability: { days: [...avail.days], weeklyHours: avail.weeklyHours, longDay: avail.longDay },
    asOf: "2026-06-22",
  };
  const skel = periodize(input);

  it("spans race-anchored weeks across the four trail phases", () => {
    expect(skel.meta.totalWeeks).toBe(12);
    expect(skel.meta.raceEFD).toBe(59.5);
    const names = skel.phases.map((p) => p.name);
    expect(names).toContain("Base");
    expect(names).toContain("Build-Vert");
    expect(names).toContain("Mountain-Specific");
    expect(names[names.length - 1]).toBe("Taper");
  });

  it("inserts 3:1 deload weeks and a final taper", () => {
    const deloads = skel.weeks.filter((w) => w.isRecoveryWeek);
    expect(deloads.length).toBeGreaterThanOrEqual(2);
    // a deload's EFD is well below the week before it
    for (const d of deloads) {
      const prev = skel.weeks[d.weekNumber - 2];
      if (prev) expect(d.targetEFD).toBeLessThan(prev.targetEFD);
    }
    const raceWeek = skel.weeks[skel.weeks.length - 1];
    expect(raceWeek.phase).toBe("Taper");
    expect(raceWeek.longRunEFD).toBe(skel.meta.raceEFD); // race week's "long" is the race
  });

  it("respects the ramp cap on consecutive build weeks (no ramp warning)", () => {
    for (let i = 1; i < skel.weeks.length; i++) {
      const a = skel.weeks[i - 1];
      const b = skel.weeks[i];
      if (a.isRecoveryWeek || b.isRecoveryWeek || b.phase === "Taper") continue;
      expect(
        isRampSafe(
          { efd: a.targetEFD, dPlus: a.targetDPlus },
          { efd: b.targetEFD, dPlus: b.targetDPlus },
          "intermediate"
        ),
        `wk${a.weekNumber}->${b.weekNumber}`
      ).toBe(true);
    }
    expect(skel.notes.some((n) => n.includes("ramp cap"))).toBe(false);
  });

  it("anchors the peak long run to ~70–80% of race EFD with real fitness", () => {
    const peakLong = Math.max(
      ...skel.weeks.filter((w) => w.phase !== "Taper").map((w) => w.longRunEFD)
    );
    expect(peakLong).toBeGreaterThanOrEqual(skel.meta.raceEFD * 0.6);
    expect(peakLong).toBeLessThanOrEqual(skel.meta.raceEFD * 0.82);
  });

  it("schedules the long run on the long day and rests off-days", () => {
    const buildWeek = skel.weeks.find((w) => w.phase === "Build-Vert")!;
    const longSlot = buildWeek.slots.find((s) => s.role === "long");
    expect(longSlot?.day).toBe("sat");
    expect(buildWeek.slots.find((s) => s.day === "mon")?.role).toBe("rest");
    expect(buildWeek.slots.find((s) => s.day === "wed")?.role).toBe("rest");
    // B2B second long appears the day after the long run in build/mountain phases
    expect(buildWeek.slots.find((s) => s.day === "sun")?.role).toBe("b2b");
  });

  it("scales weekly hours to the budget at peak", () => {
    const peakHours = Math.max(...skel.weeks.map((w) => w.targetHours));
    expect(peakHours).toBeGreaterThan(6);
    expect(peakHours).toBeLessThanOrEqual(7.5);
  });

  it("throws when the race is already past", () => {
    expect(() => periodize({ ...input, asOf: "2026-10-01" })).toThrow();
  });
});
