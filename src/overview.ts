import { histograms, summarize, type Histogram, type Summary } from "./histogram.js";
import { METRICS, type Metric } from "./metrics.js";
import { utcDay, type Device, type Navigation } from "./protocol.js";
import { ready } from "./ready.js";
import { isDay, type Period, type Store } from "./store.js";

export const MAX_DAYS = 366;

export type PeriodOptions = {
  /** Number of days, the last one included. */
  days?: number;
  /** Last day, YYYY-MM-DD. Default: today (UTC) */
  to?: string;
  /** The current time, for tests */
  now?: () => Date;
};

const DAY_MS = 86_400_000;

/** The days of a period, oldest first */
export function daysOf(options: PeriodOptions, defaultDays: number): string[] {
  const to = options.to ?? utcDay(options.now?.() ?? new Date());
  const last = isDay(to) ? Date.parse(`${to}T00:00:00Z`) : Number.NaN;
  // 31 February parses as 3 March, which is not the day that was asked for
  if (Number.isNaN(last) || utcDay(new Date(last)) !== to) {
    throw new TypeError("to must be a day, as YYYY-MM-DD");
  }
  const wanted = Math.floor(options.days ?? defaultDays);
  const count = Math.min(Math.max(Number.isFinite(wanted) ? wanted : defaultDays, 1), MAX_DAYS);
  return Array.from({ length: count }, (_, index) =>
    utcDay(new Date(last - (count - 1 - index) * DAY_MS)),
  );
}

export type Summaries = Record<Metric, Summary>;

export function summaries(group: Record<Metric, Histogram> | undefined): Summaries {
  return Object.fromEntries(
    METRICS.map((metric) => [metric, summarize(metric, group?.[metric] ?? [])]),
  ) as Summaries;
}

export type OverviewOptions = PeriodOptions & {
  /** Only this route pattern. The list of routes always shows all of them */
  route?: string;
  device?: Device;
  nav?: Navigation;
};

export type Overview = {
  period: Period;
  /** Everything in the period, per metric */
  metrics: Summaries;
  /** One entry per day of the period, oldest first, also for days without measurements */
  trend: { day: string; metrics: Summaries }[];
  /** Most measured first. `samples` is the count of the metric with the most measurements */
  routes: { route: string; samples: number; metrics: Summaries }[];
};

/** Everything a dashboard shows, in two reads. Default: the last 28 days */
export async function overview(store: Store, options: OverviewOptions = {}): Promise<Overview> {
  const days = daysOf(options, 28);
  const period = { from: days[0]!, to: days[days.length - 1]! };
  const { route, device, nav } = options;
  await ready(store);
  const [perDay, perRoute] = await Promise.all([
    store.read({ ...period, route, device, nav, by: ["day"] }),
    store.read({ ...period, device, nav, by: ["route"] }),
  ]);

  const byDay = histograms(perDay, (row) => row.day ?? "");
  const byRoute = histograms(perRoute, (row) => row.route ?? "");
  const routes = [...byRoute].map(([name, group]) => {
    const metrics = summaries(group);
    return { route: name, samples: Math.max(...METRICS.map((m) => metrics[m].count)), metrics };
  });
  routes.sort((a, b) => b.samples - a.samples || (a.route < b.route ? -1 : 1));

  return {
    period,
    metrics: summaries(histograms(perDay).get("")),
    trend: days.map((day) => ({ day, metrics: summaries(byDay.get(day)) })),
    routes,
  };
}
