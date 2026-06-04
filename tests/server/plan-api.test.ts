import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";

/**
 * /api plan-shape round-trip. coach-app.ts binds a port on import, so we mount the
 * REAL plan-api helpers (planForDate/allPlanSessions) on a throwaway app and hit
 * them over HTTP against a temp DB seeded with the FLAT incident shape — proving
 * the boundary the user actually reads renders a non-canonical plan non-empty.
 */
describe("/api plan shapes (flat-schema plan renders non-empty)", () => {
  let home: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-plan-api-"));
    process.env.HOME = home;
    const client = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    const { savePlan } = await import("../../src/db/plans.js");
    const { planForDate, allPlanSessions } = await import("../../src/server/plan-api.js");
    await client.initDatabase();
    await migrate(true);

    // Seed the flat top-level workouts[] shape with aliased fields.
    await savePlan({
      meta: { id: "api-test", athlete: "M" },
      workouts: [
        {
          date: "2026-06-06",
          sport: "running",
          title: "Long Run",
          durationMin: 120,
          distanceKm: 28,
          intensity: "Z2",
        },
        { date: "2026-06-09", sport: "running", title: "Intervals", durationMin: 60 },
      ],
    } as unknown as Parameters<typeof savePlan>[0]);

    const app = express();
    app.get("/api/summary", async (_req, res, next) => {
      try {
        res.json({ plan: await planForDate("2026-06-06") });
      } catch (e) {
        next(e);
      }
    });
    app.get("/api/plan/sessions", async (_req, res, next) => {
      try {
        res.json(await allPlanSessions());
      } catch (e) {
        next(e);
      }
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  });

  it("/api/summary surfaces today's session with normalized fields", async () => {
    const { plan } = await (await fetch(`${base}/api/summary`)).json();
    expect(plan.hasActivePlan).toBe(true);
    expect(plan.today.length).toBeGreaterThan(0);
    expect(plan.today[0].name).toBe("Long Run");
    expect(plan.today[0].distanceMeters).toBe(28000); // km → m at the boundary
    expect(typeof plan.today[0].syncedToGarmin).toBe("boolean");
    expect(plan.next?.name).toBe("Intervals");
  });

  it("/api/plan/sessions returns every planned session, date-sorted", async () => {
    const body = await (await fetch(`${base}/api/plan/sessions`)).json();
    expect(body.hasActivePlan).toBe(true);
    expect(body.sessions.map((s: { date: string }) => s.date)).toEqual([
      "2026-06-06",
      "2026-06-09",
    ]);
  });
});
