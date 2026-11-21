import { describe, expect, it } from "vitest";
import { bucketCount, bucketOf, bucketRange, EDGES } from "../src/buckets.js";
import { emptyHistogram, histograms, percentile, summarize } from "../src/histogram.js";
import { METRICS, rate, type Metric } from "../src/metrics.js";

function histogramOf(metric: Metric, values: number[]) {
  const counts = emptyHistogram(metric);
  for (const value of values) counts[bucketOf(metric, value)]!++;
  return counts;
}

/** Small seeded generator, so a failing run can be repeated */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Values spread the way load times are: most near the middle, a long tail upwards */
function skewed(next: () => number, middle: number, spread: number) {
  const normal = Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  return middle * Math.exp(spread * normal);
}

describe("percentile", () => {
  it("has no answer without measurements", () => {
    expect(percentile("LCP", emptyHistogram("LCP"), 0.75)).toBeNull();
  });

  it("assumes values are spread evenly inside a bucket", () => {
    // Four values in the bucket from 2340 to 2500
    const counts = histogramOf("LCP", [2400, 2400, 2400, 2400]);
    expect(percentile("LCP", counts, 0.75)).toBeCloseTo(2340 + 160 * 0.75);
    expect(percentile("LCP", counts, 1)).toBe(2500);
    expect(percentile("LCP", counts, 0)).toBe(2340);
  });

  it("finds the bucket the percentile falls in", () => {
    // One value up to 100, three between 2340 and 2500: the 75th percentile is the third
    // of four values, two thirds into the second bucket's counts
    const counts = histogramOf("LCP", [50, 2400, 2400, 2400]);
    expect(percentile("LCP", counts, 0.75)).toBeCloseTo(2340 + 160 * (2 / 3));
    expect(percentile("LCP", counts, 0.25)).toBe(100);
    expect(percentile("LCP", counts, 0.1)).toBeCloseTo(40);
  });

  it("answers with the last edge when the percentile is above it", () => {
    expect(percentile("LCP", histogramOf("LCP", [90_000, 120_000]), 0.75)).toBe(60_000);
  });

  it("refuses a q outside 0 to 1", () => {
    const counts = histogramOf("LCP", [1000]);
    expect(() => percentile("LCP", counts, 75)).toThrow(RangeError);
    expect(() => percentile("LCP", counts, -0.1)).toThrow(RangeError);
    expect(() => percentile("LCP", counts, NaN)).toThrow(RangeError);
  });

  it.each([
    ["TTFB", 400, 0.7],
    ["FCP", 1500, 0.6],
    ["LCP", 2400, 0.6],
    ["INP", 180, 0.9],
    ["CLS", 0.08, 1.2],
  ] as const)("%s: stays inside the bucket of the real percentile", (metric, middle, spread) => {
    const next = random(METRICS.indexOf(metric) + 1);
    for (const size of [1, 2, 3, 7, 20, 150, 5000]) {
      const values = Array.from({ length: size }, () => skewed(next, middle, spread));
      const counts = histogramOf(metric, values);
      const sorted = [...values].sort((a, b) => a - b);
      for (const q of [0.5, 0.75, 0.9, 0.99]) {
        const real = sorted[Math.ceil(q * size) - 1]!;
        const { min, max } = bucketRange(metric, bucketOf(metric, real));
        const estimate = percentile(metric, counts, q)!;
        expect(estimate).toBeGreaterThanOrEqual(min);
        expect(estimate).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe("summarize", () => {
  it("is empty without measurements", () => {
    expect(summarize("INP", emptyHistogram("INP"))).toEqual({
      count: 0,
      p75: null,
      rating: null,
      good: 0,
      needsImprovement: 0,
      poor: 0,
    });
  });

  it("counts measurements per rating", () => {
    const summary = summarize("LCP", histogramOf("LCP", [900, 2500, 2501, 4000, 4001, 99_999]));
    expect(summary).toMatchObject({ count: 6, good: 2, needsImprovement: 2, poor: 2 });
  });

  it.each(METRICS)("%s: counts per rating are exact", (metric) => {
    const next = random(100 + METRICS.indexOf(metric));
    const { good, poor } = { good: EDGES[metric][20]!, poor: EDGES[metric][40]! };
    const values = Array.from({ length: 2000 }, () => skewed(next, (good + poor) / 2, 1));
    const summary = summarize(metric, histogramOf(metric, values));
    const rated = (rating: string) => values.filter((v) => rate(metric, v) === rating).length;
    expect(summary.good).toBe(rated("good"));
    expect(summary.needsImprovement).toBe(rated("needs-improvement"));
    expect(summary.poor).toBe(rated("poor"));
    expect(summary.count).toBe(values.length);
  });

  it("rates the 75th percentile by its bucket, also right next to a threshold", () => {
    const justGood = summarize("LCP", histogramOf("LCP", [2500, 2500, 2500, 2500]));
    expect(justGood.rating).toBe("good");
    expect(justGood.p75).toBeLessThanOrEqual(2500);

    const justOver = summarize("LCP", histogramOf("LCP", [2501, 2501, 2501, 2501]));
    expect(justOver.rating).toBe("needs-improvement");
    expect(justOver.p75).toBeGreaterThan(2500);

    // So many values that the estimate rounds to the threshold itself, which on its own
    // would rate as good. The percentile is the first of the values above the threshold.
    const counts = emptyHistogram("LCP");
    counts[bucketOf("LCP", 100)] = 3e15 - 2;
    counts[bucketOf("LCP", 2501)] = 1e15;
    const rounded = summarize("LCP", counts);
    expect(rounded.p75).toBe(2500);
    expect(rounded.rating).toBe("needs-improvement");
  });

  it("rates a percentile above the last edge as poor", () => {
    const summary = summarize("CLS", histogramOf("CLS", [5, 7, 9]));
    expect(summary).toMatchObject({ p75: 2, rating: "poor", poor: 3 });
  });
});

describe("histograms", () => {
  const rows = [
    { route: "/", metric: "LCP", bucket: 3, count: 2 },
    { route: "/", metric: "LCP", bucket: 3, count: 5 },
    { route: "/", metric: "CLS", bucket: 0, count: 1 },
    { route: "/about", metric: "LCP", bucket: 9, count: 4 },
  ] as const;

  it("adds everything up into one group by default", () => {
    const groups = histograms(rows);
    expect([...groups.keys()]).toEqual([""]);
    const all = groups.get("")!;
    expect(all.LCP[3]).toBe(7);
    expect(all.LCP[9]).toBe(4);
    expect(all.CLS[0]).toBe(1);
    expect(all.INP).toEqual(emptyHistogram("INP"));
  });

  it("keeps groups apart", () => {
    const groups = histograms(rows, (row) => row.route);
    expect([...groups.keys()]).toEqual(["/", "/about"]);
    expect(groups.get("/")!.LCP[3]).toBe(7);
    expect(groups.get("/")!.LCP[9]).toBe(0);
    expect(groups.get("/about")!.LCP[9]).toBe(4);
  });

  it("leaves out counts for a bucket that does not exist", () => {
    const groups = histograms([{ metric: "LCP", bucket: 999, count: 3 } as const]);
    expect(groups.get("")!.LCP).toHaveLength(bucketCount("LCP"));
    expect(summarize("LCP", groups.get("")!.LCP).count).toBe(0);
  });
});
