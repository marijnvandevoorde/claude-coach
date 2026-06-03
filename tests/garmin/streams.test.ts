import { describe, it, expect } from "vitest";
import {
  parseSplits,
  parseDetails,
  toCompactStreams,
  fetchActivityStreams,
  type ActivityStreams,
} from "../../src/garmin/streams.js";
import type { GarminClient } from "../../src/garmin/client.js";

describe("streams: parseSplits", () => {
  it("maps lapDTOs to per-split records with derived pace (s/km)", () => {
    const splits = parseSplits({
      lapDTOs: [
        { distance: 1000, movingDuration: 300, averageHR: 150.4, elevationGain: 5 },
        { distance: 1000, duration: 320, averageHR: 158 },
      ],
    });
    expect(splits).toEqual([
      { idx: 1, distanceM: 1000, durationS: 300, paceSecPerKm: 300, avgHr: 150 },
      { idx: 2, distanceM: 1000, durationS: 320, paceSecPerKm: 320, avgHr: 158 },
    ]);
  });

  it("prefers movingDuration over duration", () => {
    const [s] = parseSplits({ lapDTOs: [{ distance: 500, movingDuration: 100, duration: 200 }] });
    expect(s.durationS).toBe(100);
    expect(s.paceSecPerKm).toBe(200);
  });

  it("skips empty/manual laps (no distance or duration)", () => {
    expect(parseSplits({ lapDTOs: [{ distance: 0, duration: 0 }, {}] })).toEqual([]);
  });

  it("returns [] for missing/garbage input", () => {
    expect(parseSplits(null)).toEqual([]);
    expect(parseSplits({})).toEqual([]);
    expect(parseSplits({ lapDTOs: "nope" })).toEqual([]);
  });

  it("tolerates a missing averageHR (avgHr → null)", () => {
    const [s] = parseSplits({ lapDTOs: [{ distance: 1000, duration: 300 }] });
    expect(s.avgHr).toBeNull();
  });
});

describe("streams: parseDetails", () => {
  const details = (hr: number[], speed?: number[]) => ({
    metricDescriptors: [
      { key: "directHeartRate", metricsIndex: 0 },
      ...(speed ? [{ key: "directSpeed", metricsIndex: 1 }] : []),
    ],
    activityDetailMetrics: hr.map((h, i) => ({
      metrics: speed ? [h, speed[i]] : [h],
    })),
  });

  it("extracts the HR series by descriptor index", () => {
    const { hr } = parseDetails(details([120, 130, 140]));
    expect(hr).toEqual([120, 130, 140]);
  });

  it("derives pace (s/km) from directSpeed (m/s)", () => {
    const { pace } = parseDetails(details([120, 130], [5, 4])); // 5 m/s → 200 s/km
    expect(pace).toEqual([200, 250]);
  });

  it("downsamples to <= max points keeping first and last", () => {
    const hrIn = Array.from({ length: 1000 }, (_, i) => 100 + (i % 50));
    const { hr } = parseDetails(details(hrIn), 200);
    expect(hr.length).toBeLessThanOrEqual(201);
    expect(hr[0]).toBe(hrIn[0]);
    expect(hr[hr.length - 1]).toBe(hrIn[hrIn.length - 1]);
  });

  it("returns empty series for missing/garbage input", () => {
    expect(parseDetails(null)).toEqual({ hr: [], pace: [] });
    expect(parseDetails({})).toEqual({ hr: [], pace: [] });
    expect(parseDetails({ metricDescriptors: [], activityDetailMetrics: [] })).toEqual({
      hr: [],
      pace: [],
    });
  });
});

describe("streams: toCompactStreams", () => {
  it("omits pace when empty and keeps splits + hr", () => {
    const s: ActivityStreams = {
      splits: [{ idx: 1, distanceM: 1000, durationS: 300, paceSecPerKm: 300, avgHr: 150 }],
      hr: [120, 130],
    };
    expect(JSON.parse(toCompactStreams(s))).toEqual(s);
  });

  it("returns '{}' sentinel when there's no real data", () => {
    expect(toCompactStreams({ splits: [], hr: [] })).toBe("{}");
  });

  it("includes pace when present", () => {
    const out = JSON.parse(toCompactStreams({ splits: [], hr: [120], pace: [300] }));
    expect(out.pace).toEqual([300]);
  });
});

describe("streams: fetchActivityStreams", () => {
  const fake = (impl: (path: string) => Promise<unknown>) =>
    ({ get: impl }) as unknown as GarminClient;

  it("combines splits + HR/pace from both endpoints", async () => {
    const out = await fetchActivityStreams(
      fake(async (path) => {
        if (path.includes("/splits")) {
          return { lapDTOs: [{ distance: 1000, duration: 300, averageHR: 150 }] };
        }
        return {
          metricDescriptors: [
            { key: "directHeartRate", metricsIndex: 0 },
            { key: "directSpeed", metricsIndex: 1 },
          ],
          activityDetailMetrics: [{ metrics: [140, 5] }],
        };
      }),
      123
    );
    expect(out.splits).toHaveLength(1);
    expect(out.hr).toEqual([140]);
    expect(out.pace).toEqual([200]);
  });

  it("is defensive: a failing endpoint yields empty data (no throw)", async () => {
    const out = await fetchActivityStreams(
      fake(async () => {
        throw new Error("HTTP 404");
      }),
      1
    );
    expect(out).toEqual({ splits: [], hr: [] });
  });

  it("returns empty (no pace key) for an indoor activity with no streams", async () => {
    const out = await fetchActivityStreams(
      fake(async () => ({})),
      1
    );
    expect(out).toEqual({ splits: [], hr: [] });
    expect(toCompactStreams(out)).toBe("{}");
  });
});
