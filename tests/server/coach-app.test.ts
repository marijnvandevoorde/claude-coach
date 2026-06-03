import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";

/**
 * Smoke test for the coach-app write+read path. We can't import coach-app.ts
 * directly (it self-runs main() and binds a port on import, before HOME is set),
 * so we mount the same data helpers it uses onto a throwaway Express app and
 * exercise a real HTTP round-trip against a temp SQLite DB. Also covers the
 * readinessContributions helper used by /api/summary.
 *
 * HOME must point at the temp dir BEFORE importing the db modules, because
 * src/lib/config.ts computes the DB path from homedir() at module load.
 */
describe("coach-app write+read smoke", () => {
  let home: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-app-"));
    process.env.HOME = home;
    const client = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    const { logHydration, hydrationTotal, getPrefs } = await import("../../src/db/wellness.js");
    await client.initDatabase();
    await migrate(true);

    const app = express();
    app.use(express.json());
    app.post("/api/hydration", async (req, res, next) => {
      try {
        const ml = req.body?.ml;
        if (typeof ml !== "number" || !Number.isInteger(ml) || ml < 1 || ml > 3000) {
          res.status(400).json({ error: "bad ml" });
          return;
        }
        await logHydration(ml, { date: req.body?.date });
        const total_ml = await hydrationTotal(req.body?.date);
        const goal_ml = (await getPrefs()).hydration_goal_ml ?? 0;
        res.json({ date: req.body?.date ?? "today", total_ml, goal_ml });
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

  it("logs hydration and reads back the accumulated total", async () => {
    const post = (ml: number) =>
      fetch(`${base}/api/hydration`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ml, date: "2026-06-01" }),
      });

    const r1 = await post(500);
    expect(r1.status).toBe(200);
    expect((await r1.json()).total_ml).toBe(500);

    const r2 = await post(250);
    expect(r2.status).toBe(200);
    const body = await r2.json();
    expect(body.total_ml).toBe(750);
    expect(typeof body.goal_ml).toBe("number");
  });

  it("rejects invalid hydration input with 400", async () => {
    const bad = await fetch(`${base}/api/hydration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ml: -5 }),
    });
    expect(bad.status).toBe(400);

    const tooBig = await fetch(`${base}/api/hydration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ml: 9000 }),
    });
    expect(tooBig.status).toBe(400);
  });
});

describe("readinessContributions (summary helper)", () => {
  it("produces signed, collapsed-sleep contributions with coverage", async () => {
    const { readinessContributions } = await import("../../src/lib/recovery.js");
    const { contributions, coverage } = readinessContributions({
      sleepScore: 88,
      sleepHistoryScore: 80,
      acwr: 1.1,
      energy: 4,
      mood: 4,
    });
    // Sleep collapses to one entry.
    expect(contributions.filter((c) => c.key === "sleep").length).toBe(1);
    // A strong sleep day is a positive contribution.
    const sleep = contributions.find((c) => c.key === "sleep")!;
    expect(sleep.points).toBeGreaterThan(0);
    expect(coverage.sleep).toBe(true);
    expect(coverage.hrv).toBe(false);
  });
});
