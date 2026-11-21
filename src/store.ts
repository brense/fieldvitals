import { isBucket } from "./buckets.js";
import { isMetric } from "./metrics.js";
import {
  DEVICES,
  NAVIGATIONS,
  type BucketCount,
  type Device,
  type Navigation,
} from "./protocol.js";

/** What counts are kept apart by, next to metric and bucket */
export const DIMENSIONS = ["day", "route", "device", "nav"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** First and last day, both included, as YYYY-MM-DD */
export type Period = { from: string; to: string };

export type Query = Period & {
  route?: string;
  device?: Device;
  nav?: Navigation;
  /** Dimensions to keep apart. Counts are added up over all the others. Default: none */
  by?: readonly Dimension[];
};

/** A count that was read back. Only the dimensions asked for with `by` are present */
export type Reading = Pick<BucketCount, "metric" | "bucket" | "count"> &
  Partial<Pick<BucketCount, Dimension>>;

/**
 * Where the counts live. A store only adds numbers up and hands them back; it knows nothing
 * about percentiles or thresholds.
 */
export interface Store {
  /** Creates what the store needs. Safe to call at every start */
  migrate(): Promise<void>;
  /** Adds counts to what is already there */
  add(counts: readonly BucketCount[]): Promise<void>;
  /** In no particular order */
  read(query: Query): Promise<Reading[]>;
  /** The routes that have counts in a period, sorted */
  routes(period: Period): Promise<string[]>;
  /** Removes all counts from before `day` and returns how many rows that were */
  prune(day: string): Promise<number>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: unknown): value is string {
  return typeof value === "string" && DAY.test(value);
}

/** Stores call this first: a query that is not what its type says must not reach a database */
export function checkQuery(query: Query): asserts query is Query {
  if (!isDay(query.from) || !isDay(query.to)) throw new TypeError("from and to must be YYYY-MM-DD");
  for (const dimension of query.by ?? []) {
    if (!DIMENSIONS.includes(dimension)) throw new TypeError(`unknown dimension: ${dimension}`);
  }
}

export function checkCounts(counts: readonly BucketCount[]): void {
  for (const { day, route, device, nav, metric, bucket, count } of counts) {
    if (!isDay(day)) throw new TypeError("day must be YYYY-MM-DD");
    if (typeof route !== "string" || route === "") throw new TypeError("route must be a string");
    if (!DEVICES.includes(device)) throw new TypeError(`unknown device: ${device}`);
    if (!NAVIGATIONS.includes(nav)) throw new TypeError(`unknown nav: ${nav}`);
    if (!isMetric(metric)) throw new TypeError(`unknown metric: ${metric}`);
    if (!isBucket(metric, bucket)) throw new TypeError(`no bucket ${bucket} for ${metric}`);
    if (!Number.isInteger(count) || count < 1) throw new TypeError("count must be 1 or more");
  }
}
