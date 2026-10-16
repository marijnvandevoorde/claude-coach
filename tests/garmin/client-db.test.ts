import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/** Garmin tokens live entirely in the DB row: no token file is needed at runtime. */
describe("garmin client: DB-only token store", () => {
  let home: string;
  let garmin: typeof import("../../src/garmin/client.js");
  let db: typeof import("../../src/db/client.js");
  const refreshCalls: URLSearchParams[] = [];

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-garmin-db-"));
    process.env.HOME = home;
    process.env.GARMINTOKENS = join(home, "does-not-exist.json");
    db = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    garmin = await import("../../src/garmin/client.js");
    await db.initDatabase();
    await migrate(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        refreshCalls.push(new URLSearchParams(String(init?.body ?? "")));
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "A1", refresh_token: "R1", expires_in: 3600 }),
          text: async () => "",
        } as unknown as Response;
      })
    );
  });

  afterAll(() => {
    delete process.env.GARMINTOKENS;
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
  });

  it("fails clearly when neither the DB nor a file holds tokens", async () => {
    await expect(garmin.GarminClient.create()).rejects.toThrow(/garmin-auth-import/);
  });

  it("refreshes from the imported DB row without any file", async () => {
    await garmin.importGarminTokens({ di_refresh_token: "R0", di_client_id: "C0", di_token: "T0" });
    await garmin.GarminClient.create();
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0].get("refresh_token")).toBe("R0");
    expect(refreshCalls[0].get("client_id")).toBe("C0");
    const [row] = await db.queryJson<{ refresh_token: string; client_id: string }>(
      "SELECT refresh_token, client_id FROM garmin_oauth WHERE id = 1"
    );
    expect(row).toEqual({ refresh_token: "R1", client_id: "C0" });
  });

  it("backfills a missing client id from a token file without touching the live token", async () => {
    await db.execute("UPDATE garmin_oauth SET client_id = NULL, expires_at = 0 WHERE id = 1");
    const file = join(home, "garmin_tokens.json");
    writeFileSync(file, JSON.stringify({ di_refresh_token: "OLD", di_client_id: "C0" }));
    process.env.GARMINTOKENS = file;
    await garmin.GarminClient.create();
    expect(refreshCalls.at(-1)?.get("refresh_token")).toBe("R1");
    const [row] = await db.queryJson<{ client_id: string }>(
      "SELECT client_id FROM garmin_oauth WHERE id = 1"
    );
    expect(row.client_id).toBe("C0");
  });
});
