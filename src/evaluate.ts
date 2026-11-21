import { histograms } from "./histogram.js";
import { METRICS, THRESHOLDS, type Metric, type Rating } from "./metrics.js";
import type { Device, Navigation } from "./protocol.js";
import { daysOf, summaries, type PeriodOptions } from "./overview.js";
import { ready } from "./ready.js";
import type { Period, Store } from "./store.js";

export type EvaluateOptions = PeriodOptions & {
  /** A metric with fewer measurements is left out: a few visits say little. Default 20 */
  minSamples?: number;
  /** `poor` (default) reports poor only; `needs-improvement` reports everything that is not good */
  level?: "poor" | "needs-improvement";
  device?: Device;
  nav?: Navigation;
};

export type Finding = {
  /** The route pattern, or `null` for the site as a whole */
  route: string | null;
  metric: Metric;
  /** 75th percentile over the period */
  p75: number;
  rating: Exclude<Rating, "good">;
  /** The threshold that was passed */
  threshold: number;
  /** Number of measurements */
  count: number;
  period: Period;
};

/**
 * Looks for metrics whose 75th percentile is rated poor, for the site as a whole and per route.
 * Default: the last 7 days. It only returns what it found; what happens with it (a mail, a
 * report to an error tracker, a failed check) is up to the caller, and so is when to call it.
 */
export async function evaluate(store: Store, options: EvaluateOptions = {}): Promise<Finding[]> {
  const days = daysOf(options, 7);
  const period = { from: days[0]!, to: days[days.length - 1]! };
  const minSamples = options.minSamples ?? 20;
  const level = options.level ?? "poor";
  await ready(store);
  const rows = await store.read({
    ...period,
    device: options.device,
    nav: options.nav,
    by: ["route"],
  });

  const findings: Finding[] = [];
  function check(route: string | null, group: ReturnType<typeof summaries>) {
    for (const metric of METRICS) {
      const { p75, rating, count } = group[metric];
      if (p75 === null || rating === null || rating === "good" || count < minSamples) continue;
      if (rating === "needs-improvement" && level === "poor") continue;
      const threshold = THRESHOLDS[metric][rating === "poor" ? "poor" : "good"];
      findings.push({ route, metric, p75, rating, threshold, count, period });
    }
  }

  check(null, summaries(histograms(rows).get("")));
  const perRoute = [...histograms(rows, (row) => row.route ?? "")];
  perRoute.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [route, group] of perRoute) check(route, summaries(group));
  return findings;
}
