/** Data-source registry. Pick with COACH_DATA_SOURCE (default "garmin"). */
import type { DataSource } from "./types.js";
import { garminSource } from "./garmin.js";
import { corosSource } from "./coros.js";

export type { DataSource, DailySnapshot } from "./types.js";

const SOURCES: Record<string, DataSource> = {
  garmin: garminSource,
  coros: corosSource, // stub — proves the seam
};

/** Resolve a data source by id (defaults to env COACH_DATA_SOURCE, then "garmin"). */
export function getDataSource(id: string = process.env.COACH_DATA_SOURCE || "garmin"): DataSource {
  const src = SOURCES[id.toLowerCase()];
  if (!src) {
    throw new Error(`Unknown data source "${id}". Known: ${Object.keys(SOURCES).join(", ")}.`);
  }
  return src;
}
