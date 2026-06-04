import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Glob the fixtures so dropping a new real-world plan JSON into accept/ or reject/
// auto-extends coverage with no wiring. Fixtures are driven by INVARIANTS (accepted
// ⟹ renders ≥1 session; rejected ⟹ refused), not blob equality, so they don't rot
// as the normalizer gains tolerance.
const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "plans");
function fixtures(sub: string): Array<{ name: string; plan: unknown }> {
  return readdirSync(join(FIX, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ name: f, plan: JSON.parse(readFileSync(join(FIX, sub, f), "utf-8")) }));
}

describe("plan contracts (across the boundary)", () => {
  let home: string;
  let plans: typeof import("../../src/db/plans.js");

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-plan-contracts-"));
    process.env.HOME = home;
    const client = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    plans = await import("../../src/db/plans.js");
    await client.initDatabase();
    await migrate(true);
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  describe("accepted plans never render empty (no silent-empty)", () => {
    for (const { name, plan } of fixtures("accept")) {
      it(`${name} → valid, saves, and yields ≥1 session`, async () => {
        const v = plans.validatePlan(plan);
        expect(v.ok, `unexpected errors: ${v.errors.join("; ")}`).toBe(true);

        await plans.savePlan(plan as Parameters<typeof plans.savePlan>[0]);
        const active = await plans.getActivePlan();
        expect(active).not.toBeNull();

        // The core invariant the incident violated: an accepted plan with workouts
        // MUST produce at least one renderable session for the app AND the push path.
        const range = plans.planDateRange(active!);
        const upcoming = plans.upcomingWorkouts(active!, range.start ?? "0000-01-01", 1000);
        expect(upcoming.length, "accepted plan produced zero sessions").toBeGreaterThan(0);
        // and the matched-by-date reader agrees on at least the first workout day
        expect(plans.sessionsForDate(active!, upcoming[0].date).length).toBeGreaterThan(0);
      });
    }
  });

  describe("malformed plans are refused loudly", () => {
    for (const { name, plan } of fixtures("reject")) {
      it(`${name} → validatePlan rejects with a reason`, () => {
        const v = plans.validatePlan(plan);
        expect(v.ok).toBe(false);
        expect(v.errors.length).toBeGreaterThan(0);
      });
    }

    it("savePlan() throws (the gate covers both write doors)", async () => {
      const bad = fixtures("reject")[0].plan as Parameters<typeof plans.savePlan>[0];
      await expect(plans.savePlan(bad)).rejects.toThrow(/rejected/i);
    });
  });

  it("aliases normalize: distanceKm → distanceMeters, title → name", () => {
    const aliased = fixtures("accept").find((f) => f.name === "aliased.json")!.plan;
    const sessions = plans.upcomingWorkouts(
      aliased as Parameters<typeof plans.upcomingWorkouts>[0],
      "0000-01-01",
      1000
    );
    const ride = sessions.find((s) => s.name === "Endurance Ride");
    expect(ride?.distanceMeters).toBe(40000);
    expect(ride?.sport).toBe("bike");
  });
});
