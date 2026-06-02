import { describe, it, expect } from "vitest";
import { parseGpx, buildCoursePayload, uploadRoute } from "../../src/garmin/routes.js";

const GPX = `<?xml version="1.0"?>
<gpx><trk><name>My Loop</name><trkseg>
<trkpt lat="46.5197" lon="6.6323"><ele>372</ele></trkpt>
<trkpt lat="46.5205" lon="6.6335"><ele>378</ele></trkpt>
<trkpt lat="46.5212" lon="6.6350"><ele>381</ele></trkpt>
</trkseg></trk></gpx>`;

describe("parseGpx", () => {
  it("extracts points (lat/lon/ele) and the track name", () => {
    const { name, points } = parseGpx(GPX);
    expect(name).toBe("My Loop");
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ lat: 46.5197, lon: 6.6323, ele: 372 });
  });

  it("handles lon-before-lat and self-closing trkpt with no elevation", () => {
    const { points } = parseGpx(
      `<gpx><trkpt lon="6.6" lat="46.5"/><trkpt lat="46.6" lon="6.7"/></gpx>`
    );
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ lat: 46.5, lon: 6.6 });
    expect(points[0].ele).toBeUndefined();
  });
});

describe("buildCoursePayload", () => {
  it("builds a verbatim course with cumulative distance, elevation, and type", () => {
    const { points } = parseGpx(GPX);
    const p = buildCoursePayload("My Loop", "mtb", points) as any;
    expect(p.activityTypePk).toBe(5); // mountain_biking
    expect(p.rulePK).toBe(2); // private
    expect(p.sourceTypeId).toBe(3);
    expect(p.coordinateSystem).toBe("WGS84");
    expect(p.geoPoints).toHaveLength(3);
    expect(p.geoPoints[0].distance).toBe(0);
    expect(p.geoPoints[2].distance).toBeGreaterThan(p.geoPoints[1].distance); // cumulative
    expect(p.distanceInMeters).toBeGreaterThan(0);
    expect(p.elevationGainInMeters).toBeCloseTo(9, 0); // +6 then +3
    expect(p.elevationLossInMeters).toBe(0);
    expect(p.startPoint.latitude).toBe(46.5197);
  });

  it("maps course types to the right activityTypePk (with fallback)", () => {
    const { points } = parseGpx(GPX);
    expect((buildCoursePayload("x", "run", points) as any).activityTypePk).toBe(1);
    expect((buildCoursePayload("x", "road", points) as any).activityTypePk).toBe(10);
    expect((buildCoursePayload("x", "gravel", points) as any).activityTypePk).toBe(143);
    expect((buildCoursePayload("x", "mountain biking", points) as any).activityTypePk).toBe(5);
    expect((buildCoursePayload("x", "whatever", points) as any).activityTypePk).toBe(1); // fallback
  });
});

describe("uploadRoute (dry-run)", () => {
  it("parses + builds the payload with no network call", async () => {
    const out = await uploadRoute({ gpx: GPX, type: "trail", dryRun: true });
    expect(out.dryRun).toBe(true);
    expect(out.points).toBe(3);
    expect(out.name).toBe("My Loop"); // defaulted from the GPX track name
    expect((out.payload as any).activityTypePk).toBe(6); // trail_running
  });

  it("rejects a GPX with too few points", async () => {
    await expect(uploadRoute({ gpx: "<gpx></gpx>", dryRun: true })).rejects.toThrow(/track points/);
  });
});
