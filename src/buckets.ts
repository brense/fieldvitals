import { THRESHOLDS, type Metric } from "./metrics.js";

/**
 * Measurements are not kept one by one. Each one is counted in a bucket, and percentiles are
 * worked out from the counts. This file defines the buckets.
 *
 * Every metric has a list of edges. Bucket `i` counts values above `edges[i - 1]` up to and
 * including `edges[i]`. Bucket 0 starts at zero, and one more bucket after the last edge
 * takes everything above it. Each edge is about 10% above the one before, and both thresholds
 * of a metric are edges, so no bucket holds values with different ratings.
 *
 * The edges are part of the storage format: stored counts refer to a bucket by its index.
 * Changing a scale makes existing data wrong, which is why `test/buckets.test.ts` pins every
 * edge.
 */

/** `first` and `last` edge in whole units; `perUnit` units make up 1 of the metric's value */
const SCALES: Record<Metric, { first: number; last: number; perUnit: number }> = {
  TTFB: { first: 20, last: 30_000, perUnit: 1 },
  FCP: { first: 100, last: 60_000, perUnit: 1 },
  LCP: { first: 100, last: 60_000, perUnit: 1 },
  // 0.01 to 2, counted in ten-thousandths so the steps below stay whole numbers
  CLS: { first: 100, last: 20_000, perUnit: 10_000 },
  INP: { first: 16, last: 10_000, perUnit: 1 },
};

/**
 * Only multiplies and rounds whole numbers, which every JavaScript engine does identically.
 * `Math.pow` or `Math.log` would be shorter, but their last digit may differ between engines.
 */
function edgesFor(metric: Metric): readonly number[] {
  const { first, last, perUnit } = SCALES[metric];
  const { good, poor } = THRESHOLDS[metric];
  const edges = [first];
  let edge = first;
  for (const stop of [Math.round(good * perUnit), Math.round(poor * perUnit), last]) {
    while (edge < stop) {
      const next = Math.round(edge * 1.1);
      // Within 5% of a stop: land on it, so a stop is always an edge and no bucket is a sliver
      edge = next * 20 >= stop * 19 ? stop : next;
      edges.push(edge);
    }
  }
  return edges.map((units) => units / perUnit);
}

export const EDGES: Readonly<Record<Metric, readonly number[]>> = {
  TTFB: edgesFor("TTFB"),
  FCP: edgesFor("FCP"),
  LCP: edgesFor("LCP"),
  CLS: edgesFor("CLS"),
  INP: edgesFor("INP"),
};

/** One bucket per edge, plus the open one above the last edge */
export function bucketCount(metric: Metric): number {
  return EDGES[metric].length + 1;
}

export function isBucket(metric: Metric, bucket: unknown): bucket is number {
  return (
    Number.isInteger(bucket) && (bucket as number) >= 0 && (bucket as number) < bucketCount(metric)
  );
}

/** The bucket a value is counted in. Expects zero or more; anything else lands in bucket 0. */
export function bucketOf(metric: Metric, value: number): number {
  const edges = EDGES[metric];
  // The first edge that is not below the value, or the open bucket when there is none
  let low = 0;
  let high = edges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (edges[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * What a bucket covers: above `min`, up to and including `max`. Bucket 0 includes zero itself.
 * For the open bucket `max` is `Infinity`.
 */
export function bucketRange(metric: Metric, bucket: number): { min: number; max: number } {
  const edges = EDGES[metric];
  return { min: bucket === 0 ? 0 : edges[bucket - 1]!, max: edges[bucket] ?? Infinity };
}
