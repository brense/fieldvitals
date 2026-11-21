import { bucketCount, bucketRange } from "../buckets.js";
import { rate, type Metric, type Rating } from "../metrics.js";
import {
  DEVICES,
  MAX_ROUTE_LENGTH,
  NAVIGATIONS,
  type Device,
  type Navigation,
} from "../protocol.js";

export const METRIC_NAMES: Readonly<Record<Metric, string>> = {
  TTFB: "Time to First Byte",
  FCP: "First Contentful Paint",
  LCP: "Largest Contentful Paint",
  CLS: "Cumulative Layout Shift",
  INP: "Interaction to Next Paint",
};

export const RATING_NAMES: Readonly<Record<Rating, string>> = {
  good: "Good",
  "needs-improvement": "Needs improvement",
  poor: "Poor",
};

/**
 * `1840` as `1.84 s`, `320` as `320 ms`; CLS has no unit. A value in the last, open bucket is
 * only known to be at least its lower edge and gets `≥` in front.
 */
export function formatValue(metric: Metric, value: number): string {
  // The first bucket of CLS runs from 0 to 0.01 and mostly holds pages that did not shift at
  // all. A number inside it would suggest a shift that was never measured
  if (metric === "CLS" && value < 0.01) return "< 0.01";
  const seconds = metric !== "CLS" && Math.round(value) >= 1000;
  // What one step of the number that is shown is worth: hundredths for CLS and for seconds
  const step = metric === "CLS" ? 0.01 : seconds ? 10 : 1;
  let steps = Math.round(value / step);
  // Just past a threshold, rounding down would show the threshold itself, which rates better
  // than the value does: "2.50 s" next to "Needs improvement"
  if (steps * step < value && rate(metric, steps * step) !== rate(metric, value)) steps++;
  const text =
    metric === "CLS"
      ? (steps / 100).toFixed(2)
      : seconds
        ? `${(steps / 100).toFixed(2)} s`
        : `${steps} ms`;
  return value >= bucketRange(metric, bucketCount(metric) - 1).min ? `≥ ${text}` : text;
}

export function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

/** Whole percentages that add up to 100, for parts of a total */
export function shares(parts: readonly number[]): number[] {
  const total = parts.reduce((sum, part) => sum + part, 0);
  if (total <= 0) return parts.map(() => 0);
  const exact = parts.map((part) => (part / total) * 100);
  const rounded = exact.map(Math.floor);
  let left = 100 - rounded.reduce((sum, part) => sum + part, 0);
  // The parts that lost most by rounding down get the remainder
  const order = exact.map((value, index) => ({ index, lost: value - Math.floor(value) }));
  order.sort((a, b) => b.lost - a.lost);
  for (const { index } of order) {
    if (left-- <= 0) break;
    rounded[index]!++;
  }
  return rounded;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-11-21` as `21 Nov 2026` */
export function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

export type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

export type Filters = {
  days: number;
  device?: Device;
  nav?: Navigation;
  route?: string;
};

export const DAY_CHOICES = [1, 7, 28, 90] as const;

function first(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

/** Reads the filters from the address. Anything that is not a known choice is ignored */
export function filtersFrom(searchParams: SearchParams, defaultDays: number): Filters {
  const days = Number(first(searchParams.days));
  const device = first(searchParams.device);
  const nav = first(searchParams.nav);
  const route = first(searchParams.route);
  return {
    days: DAY_CHOICES.includes(days as (typeof DAY_CHOICES)[number]) ? days : defaultDays,
    device: DEVICES.find((known) => known === device),
    nav: NAVIGATIONS.find((known) => known === nav),
    route: route && route.length <= MAX_ROUTE_LENGTH ? route : undefined,
  };
}

/**
 * A link to the same page with some parameters changed. `undefined` removes one. Parameters
 * that are not ours stay as they are.
 */
export function hrefWith(
  searchParams: SearchParams,
  changes: Readonly<Record<string, string | undefined>>,
): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (Object.hasOwn(changes, name) || value === undefined) continue;
    for (const item of typeof value === "string" ? [value] : value) query.append(name, item);
  }
  for (const [name, value] of Object.entries(changes)) {
    if (value !== undefined) query.set(name, value);
  }
  return `?${query.toString()}`;
}
