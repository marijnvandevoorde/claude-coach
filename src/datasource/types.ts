/**
 * Provider-neutral data-source interface.
 *
 * The coach stores GENERIC daily metrics (sleep, HRV, load, steps, …) that make
 * sense regardless of the device they came from. A data source knows how to fetch
 * those metrics from a given provider (Garmin today; Coros/Suunto/… could plug in
 * by implementing this interface — the DB schema and the ingest path don't change).
 *
 * This is the READ contract. Provider-specific WRITES (pushing workouts/routes to a
 * Garmin watch) are a separate capability and stay in src/garmin — not every source
 * can write.
 */

/** One day's snapshot: vendor-neutral wellness metrics + recent activities. */
export interface DailySnapshot {
  date: string;
  /** Flat metric map keyed by the generic wellness_state column names. */
  wellness: Record<string, number | string | null>;
  /** Recent activities mapped to the generic activities-table shape. */
  activities: Array<Record<string, unknown>>;
  /** Per-metric fetch errors (best-effort: one failure never blocks the rest). */
  errors: string[];
}

export interface DataSource {
  /** Stable id, e.g. "garmin". Also used as the provenance tag. */
  readonly id: string;
  /** Pull one day's wellness + recent activities. */
  fetchDailySnapshot(date: string): Promise<DailySnapshot>;
}
