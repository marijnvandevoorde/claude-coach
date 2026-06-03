import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Integration test for the web-push subscription data layer against the real
 * schema (catches SQL / dialect bugs before deploy). HOME is pointed at a temp
 * dir before import because the DB path is derived from homedir() at load.
 */
describe("push subscription data layer", () => {
  let home: string;
  let subs: typeof import("../../src/db/pushSubs.js");

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-push-"));
    process.env.HOME = home;
    const client = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    subs = await import("../../src/db/pushSubs.js");
    await client.initDatabase();
    await migrate(true);
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("saves, lists, counts, upserts and deletes subscriptions", async () => {
    expect(await subs.countSubscriptions()).toBe(0);

    await subs.saveSubscription(
      { endpoint: "https://push.example/abc", p256dh: "KEY1", auth: "AUTH1" },
      "test-agent"
    );
    expect(await subs.countSubscriptions()).toBe(1);

    // Re-subscribing the same endpoint updates in place (idempotent), not a dup.
    await subs.saveSubscription({
      endpoint: "https://push.example/abc",
      p256dh: "KEY1b",
      auth: "AUTH1b",
    });
    const list = await subs.listSubscriptions();
    expect(list).toHaveLength(1);
    expect(list[0].p256dh).toBe("KEY1b");
    expect(list[0].auth).toBe("AUTH1b");

    await subs.saveSubscription({
      endpoint: "https://push.example/def",
      p256dh: "KEY2",
      auth: "AUTH2",
    });
    expect(await subs.countSubscriptions()).toBe(2);

    await subs.deleteSubscription("https://push.example/abc");
    const after = await subs.listSubscriptions();
    expect(after).toHaveLength(1);
    expect(after[0].endpoint).toBe("https://push.example/def");
  });
});
