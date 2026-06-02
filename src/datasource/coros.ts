/**
 * Coros data source — STUB connector to prove the seam.
 *
 * Adding real Coros support means implementing fetchDailySnapshot here (auth +
 * mapping Coros's API into the generic DailySnapshot). Nothing else changes: the
 * DB schema, the ingest path, and the CLI/MCP all already work against any
 * DataSource. Suunto/Polar/etc. would follow the same pattern.
 */
import type { DailySnapshot, DataSource } from "./types.js";

export const corosSource: DataSource = {
  id: "coros",
  async fetchDailySnapshot(_date: string): Promise<DailySnapshot> {
    throw new Error(
      "Coros data source is not implemented yet — add fetch + mapping in src/datasource/coros.ts"
    );
  },
};
