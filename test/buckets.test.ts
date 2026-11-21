import { describe, expect, it } from "vitest";
import { bucketCount, bucketOf, bucketRange, EDGES, isBucket } from "../src/buckets.js";
import { METRICS, rate, THRESHOLDS } from "../src/metrics.js";

/**
 * The storage format. Stored counts point at these edges by index, so a change here means
 * existing data is read wrongly. Do not update this list to make a test pass.
 */
const PINNED = {
  TTFB: [
    20, 22, 24, 26, 29, 32, 35, 39, 43, 47, 52, 57, 63, 69, 76, 84, 92, 101, 111, 122, 134, 147,
    162, 178, 196, 216, 238, 262, 288, 317, 349, 384, 422, 464, 510, 561, 617, 679, 747, 800, 880,
    968, 1065, 1172, 1289, 1418, 1560, 1800, 1980, 2178, 2396, 2636, 2900, 3190, 3509, 3860, 4246,
    4671, 5138, 5652, 6217, 6839, 7523, 8275, 9103, 10013, 11014, 12115, 13327, 14660, 16126, 17739,
    19513, 21464, 23610, 25971, 30000,
  ],
  FCP: [
    100, 110, 121, 133, 146, 161, 177, 195, 215, 237, 261, 287, 316, 348, 383, 421, 463, 509, 560,
    616, 678, 746, 821, 903, 993, 1092, 1201, 1321, 1453, 1598, 1800, 1980, 2178, 2396, 2636, 3000,
    3300, 3630, 3993, 4392, 4831, 5314, 5845, 6430, 7073, 7780, 8558, 9414, 10355, 11391, 12530,
    13783, 15161, 16677, 18345, 20180, 22198, 24418, 26860, 29546, 32501, 35751, 39326, 43259,
    47585, 52344, 60000,
  ],
  LCP: [
    100, 110, 121, 133, 146, 161, 177, 195, 215, 237, 261, 287, 316, 348, 383, 421, 463, 509, 560,
    616, 678, 746, 821, 903, 993, 1092, 1201, 1321, 1453, 1598, 1758, 1934, 2127, 2340, 2500, 2750,
    3025, 3328, 3661, 4000, 4400, 4840, 5324, 5856, 6442, 7086, 7795, 8575, 9433, 10376, 11414,
    12555, 13811, 15192, 16711, 18382, 20220, 22242, 24466, 26913, 29604, 32564, 35820, 39402,
    43342, 47676, 52444, 60000,
  ],
  CLS: [
    0.01, 0.011, 0.0121, 0.0133, 0.0146, 0.0161, 0.0177, 0.0195, 0.0215, 0.0237, 0.0261, 0.0287,
    0.0316, 0.0348, 0.0383, 0.0421, 0.0463, 0.0509, 0.056, 0.0616, 0.0678, 0.0746, 0.0821, 0.0903,
    0.1, 0.11, 0.121, 0.1331, 0.1464, 0.161, 0.1771, 0.1948, 0.2143, 0.2357, 0.25, 0.275, 0.3025,
    0.3328, 0.3661, 0.4027, 0.443, 0.4873, 0.536, 0.5896, 0.6486, 0.7135, 0.7849, 0.8634, 0.9497,
    1.0447, 1.1492, 1.2641, 1.3905, 1.5296, 1.6826, 1.8509, 2,
  ],
  INP: [
    16, 18, 20, 22, 24, 26, 29, 32, 35, 39, 43, 47, 52, 57, 63, 69, 76, 84, 92, 101, 111, 122, 134,
    147, 162, 178, 200, 220, 242, 266, 293, 322, 354, 389, 428, 471, 500, 550, 605, 666, 733, 806,
    887, 976, 1074, 1181, 1299, 1429, 1572, 1729, 1902, 2092, 2301, 2531, 2784, 3062, 3368, 3705,
    4076, 4484, 4932, 5425, 5968, 6565, 7222, 7944, 8738, 10000,
  ],
};

describe("edges", () => {
  it("are exactly the pinned storage format", () => {
    expect(EDGES).toEqual(PINNED);
  });

  it.each(METRICS)("%s: rise in steps of roughly 10%% and include both thresholds", (metric) => {
    const edges = EDGES[metric];
    for (let i = 1; i < edges.length; i++) {
      const step = edges[i]! / edges[i - 1]!;
      expect(step).toBeGreaterThan(1.05);
      expect(step).toBeLessThan(1.16);
    }
    expect(edges).toContain(THRESHOLDS[metric].good);
    expect(edges).toContain(THRESHOLDS[metric].poor);
  });

  it.each(METRICS)("%s: no bucket holds values with different ratings", (metric) => {
    for (let bucket = 0; bucket < bucketCount(metric) - 1; bucket++) {
      const { min, max } = bucketRange(metric, bucket);
      // Just above the lower edge, which itself belongs to the bucket below
      const lowest = bucket === 0 ? 0 : min + (max - min) / 1000;
      expect(rate(metric, lowest)).toBe(rate(metric, max));
    }
  });
});

describe("bucketOf", () => {
  it("counts a value on an edge in the bucket that ends there", () => {
    expect(bucketOf("LCP", 0)).toBe(0);
    expect(bucketOf("LCP", 100)).toBe(0);
    expect(bucketOf("LCP", 100.5)).toBe(1);
    expect(bucketOf("LCP", 110)).toBe(1);
    const good = EDGES.LCP.indexOf(2500);
    expect(bucketOf("LCP", 2500)).toBe(good);
    expect(bucketOf("LCP", 2500.01)).toBe(good + 1);
    expect(bucketOf("CLS", 0.1)).toBe(EDGES.CLS.indexOf(0.1));
    expect(bucketOf("CLS", 0.25)).toBe(EDGES.CLS.indexOf(0.25));
  });

  it("puts everything above the last edge in the open bucket", () => {
    expect(bucketOf("LCP", 60_000)).toBe(EDGES.LCP.length - 1);
    expect(bucketOf("LCP", 60_001)).toBe(EDGES.LCP.length);
    expect(bucketOf("LCP", Number.MAX_VALUE)).toBe(bucketCount("LCP") - 1);
  });

  it.each(METRICS)("%s: agrees with bucketRange for every bucket", (metric) => {
    for (let bucket = 0; bucket < bucketCount(metric); bucket++) {
      const { min, max } = bucketRange(metric, bucket);
      if (max !== Infinity) expect(bucketOf(metric, max)).toBe(bucket);
      else expect(bucketOf(metric, min * 2)).toBe(bucket);
      if (bucket > 0) expect(bucketOf(metric, min)).toBe(bucket - 1);
    }
  });
});

describe("bucketRange", () => {
  it("starts at zero and ends open", () => {
    expect(bucketRange("INP", 0)).toEqual({ min: 0, max: 16 });
    expect(bucketRange("INP", 1)).toEqual({ min: 16, max: 18 });
    expect(bucketRange("INP", bucketCount("INP") - 1)).toEqual({ min: 10_000, max: Infinity });
  });
});

describe("isBucket", () => {
  it("accepts the indexes of a metric and nothing else", () => {
    expect(isBucket("CLS", 0)).toBe(true);
    expect(isBucket("CLS", EDGES.CLS.length)).toBe(true);
    expect(isBucket("CLS", EDGES.CLS.length + 1)).toBe(false);
    expect(isBucket("CLS", -1)).toBe(false);
    expect(isBucket("CLS", 1.5)).toBe(false);
    expect(isBucket("CLS", "1")).toBe(false);
    expect(isBucket("CLS", NaN)).toBe(false);
  });
});
