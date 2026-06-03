import { describe, it, expect } from "vitest";
import { trackToGpx, courseTypeFromSport } from "../../src/server/course-gpx.js";
import { parseGpx } from "../../src/garmin/routes.js";

describe("trackToGpx", () => {
  it("synthesizes GPX that round-trips through parseGpx (lat/lon/ele + name)", () => {
    const track = [
      [46.5197, 6.6323, 372],
      [46.5205, 6.6335, 378],
      [46.5212, 6.635],
    ];
    const gpx = trackToGpx(track, "Morning Run (from activity)");
    const { name, points } = parseGpx(gpx);
    expect(name).toBe("Morning Run (from activity)");
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ lat: 46.5197, lon: 6.6323, ele: 372 });
    // Third point has no elevation.
    expect(points[2]).toEqual({ lat: 46.5212, lon: 6.635, ele: undefined });
  });

  it("escapes XML-special characters in the name", () => {
    const gpx = trackToGpx([[1, 2]], "A & B <loop>");
    expect(gpx).toContain("<name>A &amp; B &lt;loop&gt;</name>");
  });

  it("drops malformed points (non-finite lat/lon)", () => {
    const track = [
      [1, 2, 10],
      [Number.NaN, 5],
      [3, 4],
    ] as number[][];
    const { points } = parseGpx(trackToGpx(track, "x"));
    expect(points).toHaveLength(2);
  });
});

describe("courseTypeFromSport", () => {
  it("maps ride/cycling/bike sports to cycling", () => {
    expect(courseTypeFromSport("Ride")).toBe("cycling");
    expect(courseTypeFromSport("virtual_cycling")).toBe("cycling");
    expect(courseTypeFromSport("gravel_biking")).toBe("cycling");
  });
  it("defaults everything else (incl. run, null) to run", () => {
    expect(courseTypeFromSport("Run")).toBe("run");
    expect(courseTypeFromSport("trail_running")).toBe("run");
    expect(courseTypeFromSport(null)).toBe("run");
    expect(courseTypeFromSport(undefined)).toBe("run");
  });
});
