/**
 * Upload a GPX track to Garmin Connect as a Course (route), exactly as drawn.
 *
 * We send the raw track points straight to /course-service/course — no point
 * reduction and no snap-to-roads (those are Garmin *UI* options; the API stores
 * the coordinates verbatim, so the course matches the GPX exactly).
 *
 * GPX is parsed with the standard library only (a small regex pass) — no XML dep.
 */
import { GarminClient } from "./client.js";

export interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number;
}

export interface ParsedGpx {
  name?: string;
  points: GpxPoint[];
}

// Course type (user-facing) → Garmin activityType pk (from /activity-service/activity/activityTypes).
const COURSE_TYPE_PK: Record<string, number> = {
  run: 1,
  running: 1,
  trail: 6,
  trail_running: 6,
  trailrun: 6,
  cycling: 2,
  bike: 2,
  road: 10,
  road_biking: 10,
  roadbike: 10,
  mtb: 5,
  mountain: 5,
  mountain_biking: 5,
  gravel: 143,
  gravel_cycling: 143,
  hike: 3,
  hiking: 3,
  walk: 9,
  walking: 9,
};
export const COURSE_TYPES = "run, trail, road, mtb, gravel, cycling, hike, walk";

function activityTypePk(type: string | undefined): number {
  return (
    COURSE_TYPE_PK[(type ?? "").toLowerCase().replace(/[\s-]/g, "_")] ??
    COURSE_TYPE_PK[(type ?? "").toLowerCase()] ??
    1
  );
}

/** Parse <trkpt>/<rtept> lat/lon/ele from GPX (stdlib regex; no XML dependency). */
export function parseGpx(xml: string): ParsedGpx {
  const points: GpxPoint[] = [];
  const re = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[2];
    const body = m[3] ?? "";
    const lat = Number((attrs.match(/\blat\s*=\s*"([^"]+)"/i) ?? [])[1]);
    const lon = Number((attrs.match(/\blon\s*=\s*"([^"]+)"/i) ?? [])[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleM = body.match(/<ele>\s*([\d.eE+-]+)\s*<\/ele>/i);
    const ele = eleM ? Number(eleM[1]) : undefined;
    points.push({ lat, lon, ele: Number.isFinite(ele as number) ? ele : undefined });
  }
  const nameM =
    xml.match(/<trk>[\s\S]*?<name>([\s\S]*?)<\/name>/i) ??
    xml.match(/<rte>[\s\S]*?<name>([\s\S]*?)<\/name>/i) ??
    xml.match(/<metadata>[\s\S]*?<name>([\s\S]*?)<\/name>/i);
  const name = nameM ? nameM[1].trim() : undefined;
  return { name, points };
}

const EARTH_R = 6371000;
const rad = (d: number): number => (d * Math.PI) / 180;

function haversine(a: GpxPoint, b: GpxPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/** Build the Garmin course-service create DTO from raw GPX points (verbatim — no simplification). */
export function buildCoursePayload(
  name: string,
  type: string | undefined,
  points: GpxPoint[]
): Record<string, unknown> {
  let dist = 0;
  let gain = 0;
  let loss = 0;
  const geoPoints = points.map((p, i) => {
    if (i > 0) {
      const a = points[i - 1];
      dist += haversine(a, p);
      if (p.ele != null && a.ele != null) {
        const de = p.ele - a.ele;
        if (de > 0) gain += de;
        else loss -= de;
      }
    }
    return { latitude: p.lat, longitude: p.lon, elevation: p.ele ?? 0, distance: dist };
  });

  const first = points[0];
  return {
    courseName: name,
    description: "",
    coordinateSystem: "WGS84",
    distanceInMeters: dist,
    elevationGainInMeters: gain,
    elevationLossInMeters: loss,
    activityTypePk: activityTypePk(type),
    rulePK: 2, // 2 = Private
    sourceTypeId: 3,
    startPoint: { latitude: first.lat, longitude: first.lon, elevation: first.ele ?? 0 },
    geoPoints,
  };
}

export interface UploadRouteResult {
  name: string;
  type?: string;
  points: number;
  dryRun?: boolean;
  payload?: Record<string, unknown>;
  courseId?: number;
}

/** Parse a GPX string and upload it to Garmin as a course. `dryRun` builds the payload only. */
export async function uploadRoute(opts: {
  gpx: string;
  name?: string;
  type?: string;
  dryRun?: boolean;
}): Promise<UploadRouteResult> {
  const { name: gpxName, points } = parseGpx(opts.gpx);
  if (points.length < 2) throw new Error("GPX has no usable track points (need at least 2)");
  const name = opts.name?.trim() || gpxName || "Imported route";
  const payload = buildCoursePayload(name, opts.type, points);

  if (opts.dryRun) {
    return { name, type: opts.type, points: points.length, dryRun: true, payload };
  }

  const client = await GarminClient.create();
  const res = await client.post<{ courseId: number }>("/course-service/course", payload);
  return { name, type: opts.type, points: points.length, courseId: res?.courseId };
}

export async function deleteCourse(client: GarminClient, courseId: number): Promise<void> {
  await client.del(`/course-service/course/${courseId}`);
}
