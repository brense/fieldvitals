import { bucketOf } from "./buckets.js";
import { isMetric, METRICS, type Metric } from "./metrics.js";

/**
 * What a browser sends: one report per page view, as JSON.
 *
 *     { "v": 1, "route": "/orders/[id]/edit", "device": "mobile", "nav": "hard",
 *       "metrics": [{ "name": "LCP", "value": 1840 }, { "name": "CLS", "value": 0.02 }] }
 */
export const PROTOCOL_VERSION = 1;

export const DEVICES = ["mobile", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

/** `hard` is a page load, `soft` a navigation inside the app without one */
export const NAVIGATIONS = ["hard", "soft"] as const;
export type Navigation = (typeof NAVIGATIONS)[number];

export type Report = {
  v: typeof PROTOCOL_VERSION;
  /** The route pattern, such as `/orders/[id]/edit`: never an address with real values */
  route: string;
  device: Device;
  nav: Navigation;
  /** At most one value per metric. Milliseconds, except CLS */
  metrics: { name: Metric; value: number }[];
};

export const MAX_ROUTE_LENGTH = 200;
/** A path of the characters a URL path may hold, plus `[` and `]` around parameter names */
const ROUTE = /^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/[\]]*$/;

export type ParseResult = { ok: true; report: Report } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refuse(reason: string): ParseResult {
  return { ok: false, reason };
}

/**
 * Checks what came in from a browser. Everything a report may contain is checked and copied
 * field by field; anything else in the input is left behind.
 */
export function parseReport(input: unknown): ParseResult {
  if (!isRecord(input)) return refuse("not an object");
  if (input.v !== PROTOCOL_VERSION) return refuse("unknown version");
  const { route, device, nav, metrics } = input;
  if (typeof route !== "string" || route.length > MAX_ROUTE_LENGTH || !ROUTE.test(route)) {
    return refuse("invalid route");
  }
  if (!DEVICES.includes(device as Device)) return refuse("invalid device");
  if (!NAVIGATIONS.includes(nav as Navigation)) return refuse("invalid nav");
  if (!Array.isArray(metrics) || metrics.length === 0 || metrics.length > METRICS.length) {
    return refuse("invalid metrics");
  }
  const seen = new Set<Metric>();
  const checked: Report["metrics"] = [];
  for (const entry of metrics as unknown[]) {
    if (!isRecord(entry) || !isMetric(entry.name)) return refuse("unknown metric");
    if (seen.has(entry.name)) return refuse("metric given twice");
    const { name, value } = entry;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return refuse("invalid value");
    }
    seen.add(name);
    checked.push({ name, value });
  }
  return {
    ok: true,
    report: {
      v: PROTOCOL_VERSION,
      route,
      device: device as Device,
      nav: nav as Navigation,
      metrics: checked,
    },
  };
}

/** One count in storage: how many measurements of a metric fell in a bucket */
export type BucketCount = {
  /** YYYY-MM-DD */
  day: string;
  route: string;
  device: Device;
  nav: Navigation;
  metric: Metric;
  bucket: number;
  count: number;
};

/** The counts a report adds to a day */
export function toCounts(report: Report, day: string): BucketCount[] {
  return report.metrics.map(({ name, value }) => ({
    day,
    route: report.route,
    device: report.device,
    nav: report.nav,
    metric: name,
    bucket: bucketOf(name, value),
    count: 1,
  }));
}

/** The day a moment falls on, in UTC */
export function utcDay(moment: Date = new Date()): string {
  return moment.toISOString().slice(0, 10);
}
