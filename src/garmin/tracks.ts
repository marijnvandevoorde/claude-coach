/**
 * Activity GPS tracks — download an activity's GPX from Garmin and store a compact
 * coordinate array. One stored track serves both the map (parse to coords) and
 * "create a course from this activity" (feed back into the existing course uploader).
 *
 * We reuse the GPX parser from `routes.ts` (same stdlib regex, no XML dep).
 */
import { GarminClient } from "./client.js";
import { parseGpx, type GpxPoint } from "./routes.js";

const round = (n: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Uniformly thin a track to at most `max` points, always keeping the first and last. */
export function decimate(points: GpxPoint[], max = 2500): GpxPoint[] {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  const out: GpxPoint[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Compact JSON track `[[lat,lon,ele?],…]`, coords rounded to ~1 m (5 dp). */
export function toCompactTrack(points: GpxPoint[]): string {
  return JSON.stringify(
    points.map((p) =>
      p.ele != null && Number.isFinite(p.ele)
        ? [round(p.lat, 5), round(p.lon, 5), Math.round(p.ele)]
        : [round(p.lat, 5), round(p.lon, 5)]
    )
  );
}

/**
 * Download an activity's GPX and parse it to points. Returns an empty array for
 * activities with no GPS track (indoor/pool/gym, or a 4xx from the export endpoint)
 * — the caller stores `[]` so the activity isn't re-fetched.
 */
export async function fetchActivityTrack(
  client: GarminClient,
  activityId: number | string
): Promise<GpxPoint[]> {
  let xml: string;
  try {
    xml = await client.getText(`/download-service/export/gpx/activity/${activityId}`);
  } catch {
    return [];
  }
  if (!xml || !/<(trkpt|rtept)\b/i.test(xml)) return [];
  return parseGpx(xml).points;
}
