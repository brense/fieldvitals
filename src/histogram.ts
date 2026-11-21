import { bucketCount, bucketRange } from "./buckets.js";
import { METRICS, rate, type Metric, type Rating } from "./metrics.js";

/** Counts for one metric, by bucket index */
export type Histogram = number[];

export function emptyHistogram(metric: Metric): Histogram {
  return new Array<number>(bucketCount(metric)).fill(0);
}

/** The bucket that holds the value at quantile `q`, and how far into its counts that value is */
function locate(counts: readonly number[], q: number) {
  if (!(q >= 0 && q <= 1)) throw new RangeError("q must be between 0 and 1");
  let total = 0;
  for (const count of counts) total += count;
  if (total === 0) return null;
  const target = q * total;
  let before = 0;
  let last = 0;
  for (let bucket = 0; bucket < counts.length; bucket++) {
    const count = counts[bucket]!;
    if (count <= 0) continue;
    if (before + count >= target) return { bucket, fraction: (target - before) / count, total };
    before += count;
    last = bucket;
  }
  // Only reachable through rounding in `q * total`
  return { bucket: last, fraction: 1, total };
}

/**
 * The value below which a share `q` of the measurements fall (0.75 for the 75th percentile),
 * or `null` without measurements.
 *
 * The answer is always inside the bucket that holds the real percentile, so it is off by less
 * than one bucket: about 10% at most, usually far less. When the percentile is above the last
 * edge, that edge is returned, meaning "at least this".
 */
export function percentile(metric: Metric, counts: readonly number[], q: number): number | null {
  const found = locate(counts, q);
  if (!found) return null;
  const { min, max } = bucketRange(metric, found.bucket);
  if (max === Infinity) return min;
  return min + (max - min) * found.fraction;
}

export type Summary = {
  /** Number of measurements */
  count: number;
  /** 75th percentile, the value Core Web Vitals are judged by; `null` without measurements */
  p75: number | null;
  /** Rating of the 75th percentile */
  rating: Rating | null;
  /** Number of measurements per rating. These are exact, not estimated */
  good: number;
  needsImprovement: number;
  poor: number;
};

export function summarize(metric: Metric, counts: readonly number[]): Summary {
  const summary: Summary = {
    count: 0,
    p75: percentile(metric, counts, 0.75),
    rating: null,
    good: 0,
    needsImprovement: 0,
    poor: 0,
  };
  for (let bucket = 0; bucket < counts.length; bucket++) {
    const count = counts[bucket]!;
    if (count <= 0) continue;
    summary.count += count;
    // Every value in a bucket has the rating of the bucket's upper edge
    const rating = rate(metric, bucketRange(metric, bucket).max);
    if (rating === "good") summary.good += count;
    else if (rating === "poor") summary.poor += count;
    else summary.needsImprovement += count;
  }
  // From the bucket, not from the estimate: right next to a threshold the estimate can round
  // onto the wrong side of it
  const found = locate(counts, 0.75);
  if (found) summary.rating = rate(metric, bucketRange(metric, found.bucket).max);
  return summary;
}

/**
 * Adds stored counts up into one histogram per metric, per group. Without `groupBy` everything
 * ends up in one group with the key `""`.
 */
export function histograms<R extends { metric: Metric; bucket: number; count: number }>(
  rows: readonly R[],
  groupBy: (row: R) => string = () => "",
): Map<string, Record<Metric, Histogram>> {
  const groups = new Map<string, Record<Metric, Histogram>>();
  for (const row of rows) {
    const key = groupBy(row);
    let group = groups.get(key);
    if (!group) {
      group = Object.fromEntries(METRICS.map((m) => [m, emptyHistogram(m)])) as Record<
        Metric,
        Histogram
      >;
      groups.set(key, group);
    }
    const histogram = group[row.metric];
    if (row.bucket in histogram) histogram[row.bucket]! += row.count;
  }
  return groups;
}
