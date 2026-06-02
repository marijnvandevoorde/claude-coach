import { describe, it, expect } from "vitest";
import { getDataSource } from "../../src/datasource/index.js";

describe("getDataSource", () => {
  it("defaults to garmin", () => {
    expect(getDataSource().id).toBe("garmin");
    expect(getDataSource("garmin").id).toBe("garmin");
  });

  it("registers the coros stub (proves the seam; not implemented yet)", async () => {
    const coros = getDataSource("coros");
    expect(coros.id).toBe("coros");
    await expect(coros.fetchDailySnapshot("2026-06-01")).rejects.toThrow(/not implemented/i);
  });

  it("throws on an unknown source", () => {
    expect(() => getDataSource("polar")).toThrow(/Unknown data source/);
  });
});
