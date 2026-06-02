/** Garmin data source — the first (and currently only real) DataSource. */
import { fetchGarminSnapshot } from "../garmin/snapshot.js";
import type { DailySnapshot, DataSource } from "./types.js";

export const garminSource: DataSource = {
  id: "garmin",
  async fetchDailySnapshot(date: string): Promise<DailySnapshot> {
    // fetchGarminSnapshot already returns the generic DailySnapshot shape.
    return fetchGarminSnapshot(date);
  },
};
