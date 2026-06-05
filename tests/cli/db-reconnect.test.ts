import { describe, it, expect } from "vitest";
import { isDeadConnection } from "../../src/db/client.js";

// Gates whether the MySQL backend reconnects + retries. Must catch the exact
// overnight-idle failure (a long-running coach-app's connection going stale) and
// must NOT retry on ordinary query errors (which would mask real bugs).
describe("isDeadConnection", () => {
  it("flags the overnight stale-connection error from the field report", () => {
    expect(
      isDeadConnection(new Error("Can't add new command when connection is in closed state"))
    ).toBe(true);
  });

  it("flags fatal protocol / socket drops", () => {
    expect(isDeadConnection({ fatal: true, message: "x" })).toBe(true);
    expect(isDeadConnection({ code: "PROTOCOL_CONNECTION_LOST" })).toBe(true);
    expect(isDeadConnection({ code: "ECONNRESET" })).toBe(true);
    expect(isDeadConnection(new Error("The server has gone away"))).toBe(true);
  });

  it("does NOT flag ordinary query errors (no blind retry)", () => {
    expect(
      isDeadConnection(new Error("ER_PARSE_ERROR: You have an error in your SQL syntax"))
    ).toBe(false);
    expect(isDeadConnection({ code: "ER_DUP_ENTRY" })).toBe(false);
    expect(isDeadConnection(undefined)).toBe(false);
  });
});
