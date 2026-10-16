import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/** Re-fetching a Garmin activity must not wipe what was stored on it since. */
describe("saveGarminActivity", () => {
  let home: string;
  let db: typeof import("../../src/db/client.js");
  let acts: typeof import("../../src/db/activities.js");

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-gact-"));
    process.env.HOME = home;
    db = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    acts = await import("../../src/db/activities.js");
    await db.initDatabase();
    await migrate(true);
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("updates the summary but keeps track, streams and coach notes", async () => {
    const a = { id: 42, name: "Run", sport_type: "Run", start_date: "2026-10-10 07:00:00" };
    await acts.saveGarminActivity(a);
    await db.execute(
      `UPDATE activities SET gps_track = '[[1,2]]', activity_streams = '{}', coach_notes = 'felt good' WHERE id = 42;`
    );
    await acts.saveGarminActivity({ ...a, name: "Morning run", distance: 5000 });
    const [row] = await db.queryJson<Record<string, unknown>>(
      "SELECT name, distance, gps_track, activity_streams, coach_notes FROM activities WHERE id = 42"
    );
    expect(row).toEqual({
      name: "Morning run",
      distance: 5000,
      gps_track: "[[1,2]]",
      activity_streams: "{}",
      coach_notes: "felt good",
    });
  });

  it("saveStravaActivity keeps track, streams, coach notes and adherence on re-sync", async () => {
    const a = {
      id: 77,
      name: "Ride",
      sport_type: "Ride",
      start_date: "2026-10-11T08:00:00Z",
    } as unknown as import("../../src/strava/types.js").StravaActivity;
    await acts.saveStravaActivity(a);
    await db.execute(
      `UPDATE activities SET gps_track = '[[3,4]]', activity_streams = '{}', coach_notes = 'windy', adherence_json = '{"c":1}' WHERE id = 77;`
    );
    await acts.saveStravaActivity({ ...a, name: "Evening ride", distance: 20000 });
    const [row] = await db.queryJson<Record<string, unknown>>(
      "SELECT name, distance, gps_track, activity_streams, coach_notes, adherence_json FROM activities WHERE id = 77"
    );
    expect(row).toEqual({
      name: "Evening ride",
      distance: 20000,
      gps_track: "[[3,4]]",
      activity_streams: "{}",
      coach_notes: "windy",
      adherence_json: '{"c":1}',
    });
  });
});
