import { describe, it, expect } from "vitest";
import { decimate, toCompactTrack, fetchActivityTrack } from "../../src/garmin/tracks.js";
import type { GarminClient } from "../../src/garmin/client.js";

const GPX = `<?xml version="1.0"?><gpx><trk><name>Run</name><trkseg>
  <trkpt lat="51.05123456" lon="3.7212345"><ele>12.4</ele></trkpt>
  <trkpt lat="51.05223456" lon="3.7222345"><ele>13.9</ele></trkpt>
  <trkpt lat="51.05323456" lon="3.7232345"></trkpt>
</trkseg></trk></gpx>`;

describe("tracks: decimate", () => {
  it("thins to <= max+1 points, keeping first and last", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => ({ lat: i, lon: i }));
    const out = decimate(pts, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });
  it("returns the input unchanged when already small", () => {
    const pts = [
      { lat: 1, lon: 2 },
      { lat: 3, lon: 4 },
    ];
    expect(decimate(pts, 100)).toBe(pts);
  });
});

describe("tracks: toCompactTrack", () => {
  it("rounds coords to 5dp, rounds elevation, omits ele when absent", () => {
    const json = toCompactTrack([
      { lat: 51.051234567, lon: 3.721234567, ele: 12.4 },
      { lat: 51.052234567, lon: 3.722234567 },
    ]);
    expect(JSON.parse(json)).toEqual([
      [51.05123, 3.72123, 12],
      [51.05223, 3.72223],
    ]);
  });
});

describe("tracks: fetchActivityTrack", () => {
  const fake = (impl: () => Promise<string>) => ({ getText: impl }) as unknown as GarminClient;

  it("parses GPX trackpoints from the download endpoint", async () => {
    const pts = await fetchActivityTrack(
      fake(async () => GPX),
      123
    );
    expect(pts).toHaveLength(3);
    expect(pts[0]).toMatchObject({ lat: 51.05123456, lon: 3.7212345, ele: 12.4 });
    expect(pts[2].ele).toBeUndefined();
  });

  it("returns [] when the export has no track (indoor/no-GPS)", async () => {
    expect(
      await fetchActivityTrack(
        fake(async () => "<gpx></gpx>"),
        1
      )
    ).toEqual([]);
  });

  it("returns [] when the endpoint errors", async () => {
    expect(
      await fetchActivityTrack(
        fake(async () => {
          throw new Error("HTTP 404");
        }),
        1
      )
    ).toEqual([]);
  });
});
