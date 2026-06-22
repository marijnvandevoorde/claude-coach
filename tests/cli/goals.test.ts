import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Goal + availability data layer — the "nothing hardcoded, findable via MCP"
// backbone. DB tests follow the plans.test.ts pattern: a temp HOME (the SQLite
// path derives from it) + a full migrate() in beforeAll, isolated per file.

describe("training goals data layer", () => {
  let home: string;
  let goals: typeof import("../../src/db/goals.js");

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-goals-"));
    process.env.HOME = home;
    const client = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    goals = await import("../../src/db/goals.js");
    await client.initDatabase();
    await migrate(true);
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("derives a stable slug id from name + event month", () => {
    expect(goals.slugifyGoalId("Trail des Hautes Fagnes", "2026-09-13")).toBe(
      "trail-des-hautes-fagnes-2026-09"
    );
    // Accents are folded, punctuation collapses to single dashes.
    expect(goals.slugifyGoalId("Côte & Vert!", "2027-01-02")).toBe("cote-vert-2027-01");
  });

  it("saves a goal (id derived), applies defaults, and reads it back", async () => {
    const id = await goals.saveGoal({
      name: "Trail des Hautes Fagnes",
      event_date: "2026-09-13",
      event_type: "trail",
      distance_km: 45,
      elevation_gain_m: 1450,
    });
    expect(id).toBe("trail-des-hautes-fagnes-2026-09");
    const g = await goals.getGoal(id);
    expect(g?.priority).toBe("A"); // default
    expect(g?.goal_type).toBe("finish"); // default
    expect(g?.status).toBe("active"); // default
    expect(g?.distance_km).toBe(45);
    expect(g?.elevation_gain_m).toBe(1450);
  });

  it("updates in place on re-save (same id) and preserves created_at", async () => {
    const before = await goals.getGoal("trail-des-hautes-fagnes-2026-09");
    await goals.saveGoal({
      id: "trail-des-hautes-fagnes-2026-09",
      name: "Trail des Hautes Fagnes",
      event_date: "2026-09-13",
      distance_km: 45,
      elevation_gain_m: 1450,
      goal_type: "finish-strong",
      target_time: "5:30:00",
    });
    const after = await goals.getGoal("trail-des-hautes-fagnes-2026-09");
    expect(after?.goal_type).toBe("finish-strong");
    expect(after?.target_time).toBe("5:30:00");
    expect(after?.created_at).toBe(before?.created_at); // not bumped
  });

  it("resolves the primary A-race: active + priority A + nearest FUTURE date", async () => {
    // A past A-race, a future B-race, and two future A-races.
    await goals.saveGoal({ id: "past-a", name: "Past A", event_date: "2020-01-01", priority: "A" });
    await goals.saveGoal({
      id: "future-b",
      name: "B race",
      event_date: "2026-07-01",
      priority: "B",
    });
    await goals.saveGoal({ id: "far-a", name: "Far A", event_date: "2027-05-01", priority: "A" });
    // Hautes Fagnes (2026-09-13, A) is the nearest future A-race from mid-2026.
    const primary = await goals.getPrimaryGoal("2026-06-22");
    expect(primary?.id).toBe("trail-des-hautes-fagnes-2026-09");
  });

  it("excludes completed/abandoned goals from primary resolution", async () => {
    await goals.setGoalStatus("trail-des-hautes-fagnes-2026-09", "completed");
    const primary = await goals.getPrimaryGoal("2026-06-22");
    expect(primary?.id).toBe("far-a"); // next active A-race
    await goals.setGoalStatus("trail-des-hautes-fagnes-2026-09", "active"); // restore
  });

  it("lists goals active-first then by date, and deletes by id", async () => {
    const list = await goals.listGoals();
    expect(list.length).toBeGreaterThanOrEqual(4);
    await goals.deleteGoal("far-a");
    expect(await goals.getGoal("far-a")).toBeNull();
  });

  it("weeksToGoal counts whole weeks (null without a date, negative once past)", () => {
    expect(goals.weeksToGoal({ event_date: "2026-09-13" }, "2026-06-22")).toBe(12);
    expect(goals.weeksToGoal({ event_date: null })).toBeNull();
    expect(goals.weeksToGoal({ event_date: "2026-01-01" }, "2026-06-22")).toBeLessThan(0);
  });

  it("raceEFD = distance + (D+/100)·k (default k=1.0); null without distance", () => {
    expect(goals.raceEFD({ distance_km: 45, elevation_gain_m: 1450 })).toBe(59.5);
    // k is the technical surcharge: 45 + 14.5·1.2 = 62.4
    expect(goals.raceEFD({ distance_km: 45, elevation_gain_m: 1450 }, 1.2)).toBe(62.4);
    expect(goals.raceEFD({ distance_km: 10, elevation_gain_m: null })).toBe(10);
    expect(goals.raceEFD({ distance_km: null, elevation_gain_m: 500 })).toBeNull();
  });

  it("isTrailGoal keys off type, then text signals, then vert", () => {
    expect(goals.isTrailGoal({ event_type: "trail" })).toBe(true);
    expect(goals.isTrailGoal({ event_type: "road", elevation_gain_m: 1200 })).toBe(true); // vert
    expect(
      goals.isTrailGoal({ event_type: "road", name: "City Marathon", elevation_gain_m: 80 })
    ).toBe(false);
  });
});

describe("athlete availability data layer", () => {
  let home: string;
  let avail: typeof import("../../src/db/availability.js");

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-avail-"));
    process.env.HOME = home;
    const client = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    avail = await import("../../src/db/availability.js");
    await client.initDatabase();
    await migrate(true);
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("seeds an empty single row (reads never return null)", async () => {
    const a = await avail.getAvailability();
    expect(a.days).toEqual([]);
    expect(a.weeklyHours).toBeNull();
    expect(avail.isAvailabilityComplete(a)).toBe(false);
  });

  it("normalizes day input and orders tokens by week", () => {
    expect(avail.parseDays("Saturday, tue, THU, sun")).toEqual(["tue", "thu", "sat", "sun"]);
    expect(avail.parseDays('["sat","mon"]')).toEqual(["mon", "sat"]);
    expect(avail.parseDays(["fri", "fri", "wed"])).toEqual(["wed", "fri"]); // de-duped
    expect(avail.normalizeDay("Saturday")).toBe("sat");
    expect(avail.normalizeDay("garbage")).toBeNull();
  });

  it("updates a subset and parses the stored row back into a view", async () => {
    await avail.updateAvailability({
      days: "tue,thu,sat,sun",
      weeklyHours: 7,
      longDay: "Saturday",
    });
    const a = await avail.getAvailability();
    expect(a.days).toEqual(["tue", "thu", "sat", "sun"]);
    expect(a.weeklyHours).toBe(7);
    expect(a.longDay).toBe("sat");
    expect(avail.isAvailabilityComplete(a)).toBe(true);
  });

  it("leaves untouched fields alone on a partial update", async () => {
    await avail.updateAvailability({ doublesOk: true });
    const a = await avail.getAvailability();
    expect(a.doublesOk).toBe(true);
    expect(a.weeklyHours).toBe(7); // unchanged
    expect(a.days).toEqual(["tue", "thu", "sat", "sun"]); // unchanged
  });
});
