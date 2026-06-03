/**
 * Activity streams — real per-activity splits + a downsampled heart-rate (and pace)
 * stream, fetched from Garmin Connect and stored as one compact JSON blob per activity.
 *
 * Mirrors `tracks.ts`: pure parse helpers (testable without the network) plus a
 * `fetchActivityStreams(client, id)` that is defensive — any endpoint or parse
 * failure yields empty arrays (never throws), so the caller can store a sentinel
 * and skip re-fetching.
 *
 * Endpoints (connectapi):
 *   - splits:  GET /activity-service/activity/{id}/splits          → { lapDTOs: [...] }
 *   - details: GET /activity-service/activity/{id}/details
 *                  ?maxChartSize=240&maxPolylineSize=0
 *              → { metricDescriptors: [...], activityDetailMetrics: [...] }
 */
import type { GarminClient } from "./client.js";

/** One activity split (lap), with derived pace. */
export interface Split {
  idx: number;
  distanceM: number;
  durationS: number;
  paceSecPerKm: number | null;
  avgHr: number | null;
}

/** Compact stored shape: real splits + a downsampled HR series (+ pace if available). */
export interface ActivityStreams {
  splits: Split[];
  hr: number[];
  pace?: number[];
}

interface LapDTO {
  distance?: number; // metres
  duration?: number; // seconds (total)
  movingDuration?: number; // seconds (moving)
  averageHR?: number;
  elevationGain?: number;
  [k: string]: unknown;
}
interface SplitsResponse {
  lapDTOs?: LapDTO[];
}

interface MetricDescriptor {
  key?: string;
  metricsIndex?: number;
}
interface DetailMetric {
  metrics?: (number | null)[];
}
interface DetailsResponse {
  metricDescriptors?: MetricDescriptor[];
  activityDetailMetrics?: DetailMetric[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Map raw `lapDTOs` to per-split records with derived pace (s/km). */
export function parseSplits(raw: unknown): Split[] {
  const laps = (raw as SplitsResponse | null)?.lapDTOs;
  if (!Array.isArray(laps)) return [];
  const out: Split[] = [];
  laps.forEach((lap, i) => {
    const distanceM = num(lap?.distance) ?? 0;
    const durationS = num(lap?.movingDuration) ?? num(lap?.duration) ?? 0;
    if (distanceM <= 0 || durationS <= 0) return; // skip empty/manual laps
    const paceSecPerKm = Math.round((durationS / distanceM) * 1000);
    out.push({
      idx: i + 1,
      distanceM: Math.round(distanceM),
      durationS: Math.round(durationS),
      paceSecPerKm,
      avgHr: num(lap?.averageHR) != null ? Math.round(num(lap.averageHR) as number) : null,
    });
  });
  return out;
}

/** Uniformly downsample a series to at most `max` points (keeps first + last). */
function downsample(vals: number[], max: number): number[] {
  if (vals.length <= max) return vals;
  const stride = Math.ceil(vals.length / max);
  const out: number[] = [];
  for (let i = 0; i < vals.length; i += stride) out.push(vals[i]);
  const last = vals[vals.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Extract a downsampled HR series (and pace series, if a speed/pace metric is
 * present) from the activity `details` payload. Returns `{ hr: [], pace: [] }`
 * when the payload is missing/unparseable or has no HR data.
 */
export function parseDetails(raw: unknown, max = 200): { hr: number[]; pace: number[] } {
  const data = raw as DetailsResponse | null;
  const descriptors = data?.metricDescriptors;
  const rows = data?.activityDetailMetrics;
  if (!Array.isArray(descriptors) || !Array.isArray(rows)) return { hr: [], pace: [] };

  const idxOf = (key: string): number | null => {
    const d = descriptors.find((x) => x?.key === key);
    return d && typeof d.metricsIndex === "number" ? d.metricsIndex : null;
  };
  const hrIdx = idxOf("directHeartRate");
  const speedIdx = idxOf("directSpeed"); // m/s
  const paceIdx = idxOf("directPace"); // s/m (Garmin pace)

  const hrRaw: number[] = [];
  const paceRaw: number[] = [];
  for (const row of rows) {
    const m = row?.metrics;
    if (!Array.isArray(m)) continue;
    if (hrIdx != null) {
      const v = num(m[hrIdx]);
      if (v != null) hrRaw.push(Math.round(v));
    }
    if (speedIdx != null) {
      const v = num(m[speedIdx]);
      if (v != null && v > 0) paceRaw.push(Math.round(1000 / v)); // s/km
    } else if (paceIdx != null) {
      const v = num(m[paceIdx]);
      if (v != null && v > 0) paceRaw.push(Math.round(v * 1000)); // s/m → s/km
    }
  }
  return { hr: downsample(hrRaw, max), pace: downsample(paceRaw, max) };
}

/**
 * Fetch an activity's real splits + HR/pace streams. Defensive: a failure on
 * either endpoint just yields empty data for that part (never throws), so the
 * caller can store a sentinel and avoid re-fetching.
 */
export async function fetchActivityStreams(
  client: GarminClient,
  activityId: number | string
): Promise<ActivityStreams> {
  let splits: Split[] = [];
  let hr: number[] = [];
  let pace: number[] = [];

  try {
    const raw = await client.get(`/activity-service/activity/${activityId}/splits`);
    splits = parseSplits(raw);
  } catch {
    /* leave splits empty */
  }
  try {
    const raw = await client.get(
      `/activity-service/activity/${activityId}/details?maxChartSize=240&maxPolylineSize=0`
    );
    const d = parseDetails(raw);
    hr = d.hr;
    pace = d.pace;
  } catch {
    /* leave hr/pace empty */
  }

  const out: ActivityStreams = { splits, hr };
  if (pace.length) out.pace = pace;
  return out;
}

/** Compact stored JSON. `{}` when there's no real data (so it isn't re-fetched). */
export function toCompactStreams(s: ActivityStreams): string {
  if (s.splits.length === 0 && s.hr.length === 0) return "{}";
  const obj: ActivityStreams = { splits: s.splits, hr: s.hr };
  if (s.pace && s.pace.length) obj.pace = s.pace;
  return JSON.stringify(obj);
}
