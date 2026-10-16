import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/** The MCP OAuth client store (formerly oauth-clients.json) against the real schema. */
describe("oauth client store", () => {
  let home: string;
  let store: typeof import("../../src/db/oauthClients.js");

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-oauth-"));
    process.env.HOME = home;
    const client = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    store = await import("../../src/db/oauthClients.js");
    await client.initDatabase();
    await migrate(true);
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("saves and finds a client", async () => {
    await store.saveOAuthClient({ client_id: "abc", redirect_uris: ["https://x/cb"] });
    expect(await store.getOAuthClient("abc")).toEqual({
      client_id: "abc",
      redirect_uris: ["https://x/cb"],
    });
    expect(await store.getOAuthClient("nope")).toBeNull();
  });

  it("imports a legacy oauth-clients.json once, keeping existing rows", async () => {
    const file = join(home, "oauth-clients.json");
    writeFileSync(
      file,
      JSON.stringify({
        abc: { client_id: "abc", redirect_uris: ["https://changed/cb"] },
        def: { client_id: "def", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] },
        bad: { client_id: "bad", redirect_uris: [] },
      })
    );
    expect(await store.importLegacyOAuthClients(file)).toBe(1);
    expect(await store.importLegacyOAuthClients(file)).toBe(0);
    expect((await store.getOAuthClient("abc"))?.redirect_uris).toEqual(["https://x/cb"]);
    expect((await store.getOAuthClient("def"))?.redirect_uris).toEqual([
      "https://claude.ai/api/mcp/auth_callback",
    ]);
    expect(await store.countOAuthClients()).toBe(2);
    expect(await store.importLegacyOAuthClients(join(home, "missing.json"))).toBe(0);
  });
});
