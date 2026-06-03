/**
 * Helpers to turn an activity's stored compact GPS track ([[lat,lon,ele?],…])
 * into a minimal GPX document + a course-type guess, for /api/course-from-activity.
 *
 * Kept in its own module (no side effects) so it's unit-testable without
 * importing coach-app.ts, which self-runs main() on import.
 */

/** Map a Garmin/Strava sport_type onto a course type uploadRoute understands. */
export function courseTypeFromSport(sport: string | null | undefined): string {
  const s = (sport ?? "").toLowerCase();
  if (s.includes("ride") || s.includes("cycl") || s.includes("bik")) return "cycling";
  return "run";
}

/** Synthesize a minimal GPX document from a compact track ([[lat,lon,ele?],…]). */
export function trackToGpx(track: number[][], name: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pts = track
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => {
      const ele = Number.isFinite(p[2]) ? `<ele>${p[2]}</ele>` : "";
      return `<trkpt lat="${p[0]}" lon="${p[1]}">${ele}</trkpt>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="coach"><trk><name>${esc(name)}</name><trkseg>${pts}</trkseg></trk></gpx>`;
}
