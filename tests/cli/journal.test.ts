import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("journal data layer", () => {
  let home: string;
  let journal: typeof import("../../src/db/journal.js");

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-journal-"));
    process.env.HOME = home;
    const client = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    journal = await import("../../src/db/journal.js");
    await client.initDatabase();
    await migrate(true);
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("adds and lists entries (newest first, filtered by since)", async () => {
    await journal.addJournalEntry("legs heavy", { date: "2026-06-01", tag: "note" });
    await journal.addJournalEntry("great session", { date: "2026-06-02" });
    await journal.addJournalEntry("old one", { date: "2026-05-01" });

    const recent = await journal.listJournalEntries({ since: "2026-06-01" });
    expect(recent.map((e) => e.entry)).toEqual(["great session", "legs heavy"]);
    expect(recent[1].tag).toBe("note");

    expect((await journal.listJournalEntries()).length).toBe(3);
  });

  it("stores quotes verbatim", async () => {
    await journal.addJournalEntry(`O'Brien's "big" day`, { date: "2026-06-03" });
    const e = await journal.listJournalEntries({ since: "2026-06-03", until: "2026-06-03" });
    expect(e[0].entry).toBe(`O'Brien's "big" day`);
  });
});
