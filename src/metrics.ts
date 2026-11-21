/** The web vitals this package keeps, in the order a page load produces them */
export const METRICS = ["TTFB", "FCP", "LCP", "CLS", "INP"] as const;
export type Metric = (typeof METRICS)[number];

export const RATINGS = ["good", "needs-improvement", "poor"] as const;
export type Rating = (typeof RATINGS)[number];

/**
 * The thresholds from web.dev, the same ones the `web-vitals` library rates with: up to and
 * including `good` is good, above `poor` is poor. Milliseconds, except CLS, which has no unit.
 */
export const THRESHOLDS: Readonly<Record<Metric, { good: number; poor: number }>> = {
  TTFB: { good: 800, poor: 1800 },
  FCP: { good: 1800, poor: 3000 },
  LCP: { good: 2500, poor: 4000 },
  CLS: { good: 0.1, poor: 0.25 },
  INP: { good: 200, poor: 500 },
};

export function isMetric(name: unknown): name is Metric {
  return METRICS.includes(name as Metric);
}

export function rate(metric: Metric, value: number): Rating {
  const { good, poor } = THRESHOLDS[metric];
  return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor";
}
