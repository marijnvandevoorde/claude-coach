import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Integration test for the wellness data layer + schema migration.
 * We point HOME at a temp dir BEFORE importing the modules, because
 * src/lib/config.ts computes the DB path from homedir() at module load.
 */
describe("wellness data layer + migration", () => {
  let home: string;
  let wellness: typeof import("../../src/db/wellness.js");

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-wellness-"));
    process.env.HOME = home;
    const client = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    wellness = await import("../../src/db/wellness.js");
    await client.initDatabase();
    migrate(true);
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("seeds a single reminder_prefs row with defaults (incl. notify columns)", () => {
    const prefs = wellness.getPrefs();
    expect(prefs.id).toBe(1);
    expect(prefs.hydration_goal_ml).toBe(2500);
    expect(prefs.water_cadence_minutes).toBe(60);
    expect(prefs.hydration_per_active_hour_ml).toBe(500);
    expect(prefs.reminders_enabled).toBe(1);
    expect(prefs.notify_channel).toBe("auto");
    expect(prefs.notify_webhook_url).toBeNull();
  });

  it("updates prefs across text, numeric, and notify columns", () => {
    wellness.updatePrefs({
      bedtime_target: "22:30",
      hydration_goal_ml: 3000,
      notify_webhook_url: "https://ha/x",
      notify_channel: "webhook",
    });
    const p = wellness.getPrefs();
    expect(p.bedtime_target).toBe("22:30");
    expect(p.hydration_goal_ml).toBe(3000);
    expect(p.notify_webhook_url).toBe("https://ha/x");
    expect(p.notify_channel).toBe("webhook");
  });

  it("logs hydration and sums per local date", () => {
    wellness.logHydration(500, { date: "2026-06-01" });
    wellness.logHydration(250, { date: "2026-06-01" });
    wellness.logHydration(999, { date: "2026-05-31" });
    expect(wellness.hydrationTotal("2026-06-01")).toBe(750);
    expect(wellness.hydrationTotal("2026-05-31")).toBe(999);
    expect(wellness.hydrationTotal("2026-01-01")).toBe(0);
  });

  it("upserts wellness rows — insert then merge", () => {
    wellness.upsertWellness("2026-06-01", { sleep_hours: 7.5, readiness_score: 80 });
    expect(wellness.getWellness("2026-06-01")?.readiness_score).toBe(80);

    // Second upsert updates readiness and adds hrv_status, keeps sleep_hours.
    wellness.upsertWellness("2026-06-01", { readiness_score: 42, hrv_status: "unbalanced" });
    const w = wellness.getWellness("2026-06-01");
    expect(w?.readiness_score).toBe(42);
    expect(w?.sleep_hours).toBe(7.5);
    expect(w?.hrv_status).toBe("unbalanced");
  });

  it("safely stores text containing single quotes", () => {
    wellness.upsertWellness("2026-06-02", { notes: "O'Brien's plan" });
    expect(wellness.getWellness("2026-06-02")?.notes).toBe("O'Brien's plan");
  });

  it("returns null for a date with no wellness row", () => {
    expect(wellness.getWellness("2099-01-01")).toBeNull();
  });
});
