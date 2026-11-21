import { isMetric, METRICS, type Metric } from "./metrics.js";
import { PROTOCOL_VERSION, type Device, type Navigation, type Report } from "./protocol.js";

/**
 * A measurement as the `web-vitals` library hands it over (Next's `useReportWebVitals` passes
 * it on unchanged). Only these fields are read.
 */
export type VitalsMetric = {
  name: string;
  value: number;
  /** `soft-navigation` for a navigation without a page load, `back-forward-cache` for a restore */
  navigationType?: string;
  /** Tells page views in the same document apart */
  navigationId?: string | number;
  /** The address the measurement belongs to */
  navigationURL?: string;
};

export type CollectorEnv = {
  /** Sends one report, as JSON */
  send(body: string): void;
  device(): Device;
  /** Whether the page is hidden right now */
  hidden(): boolean;
  /** The path the document was loaded with, for measurements that carry no address */
  landing(): string;
  /** Runs something a little later */
  later(run: () => void, ms: number): void;
};

export type Collector = {
  /**
   * Tells the collector which route pattern a path has. `null`: the pattern is not known, and
   * nothing is sent for that path.
   */
  setRoute(pathname: string, pattern: string | null): void;
  report(metric: VitalsMetric): void;
  /** Sends what is waiting. Call it when the page is hidden */
  flush(): void;
};

type View = {
  nav: Navigation;
  path: string;
  /** Measured and not sent yet */
  waiting: Map<Metric, number>;
  sent: Set<Metric>;
};

/** Enough for a long visit; beyond it the oldest are forgotten */
const MAX_VIEWS = 20;
const MAX_PATHS = 100;
/** A page view that was left gets its last values right away. This is how long they get */
const SETTLE_MS = 3000;

function pathKey(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function pathOf(address: string | undefined, fallback: () => string): string {
  if (address) {
    try {
      return pathKey(new URL(address, "http://localhost").pathname);
    } catch {
      // Not an address: use the fallback
    }
  }
  return pathKey(fallback());
}

/**
 * Collects measurements per page view and sends one report per page view when the page is
 * hidden, which is the last moment a browser reliably gives. Each metric is sent once per page
 * view, with the value it had at that moment.
 *
 * A page that comes back from the back/forward cache is not counted as a new page view.
 */
export function createCollector(env: CollectorEnv): Collector {
  const patterns = new Map<string, string | null>();
  const views = new Map<string, View>();
  let settling = false;
  let leaving = false;

  function sendView(view: View) {
    if (view.waiting.size === 0) return;
    const route = patterns.get(view.path);
    // The route of this path is not known yet. It may still come
    if (route === undefined) return;
    const metrics = METRICS.flatMap((name) => {
      const value = view.waiting.get(name);
      return value === undefined ? [] : [{ name, value }];
    });
    for (const name of view.waiting.keys()) view.sent.add(name);
    view.waiting.clear();
    if (route === null) return;
    const report: Report = {
      v: PROTOCOL_VERSION,
      route,
      device: env.device(),
      nav: view.nav,
      metrics,
    };
    env.send(JSON.stringify(report));
  }

  /** `all` false: every page view except the newest, which is still being measured */
  function flush(all: boolean) {
    const list = [...views.values()];
    list.forEach((view, index) => {
      if (all || index < list.length - 1) sendView(view);
    });
  }

  return {
    setRoute(pathname, pattern) {
      const key = pathKey(pathname);
      patterns.delete(key);
      patterns.set(key, pattern);
      if (patterns.size > MAX_PATHS) patterns.delete(patterns.keys().next().value!);
    },

    report(metric) {
      const { name, value } = metric;
      if (!isMetric(name) || typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return;
      }
      if (metric.navigationType === "back-forward-cache") return;
      const nav: Navigation = metric.navigationType === "soft-navigation" ? "soft" : "hard";
      const key = `${nav} ${metric.navigationId ?? ""}`;
      let view = views.get(key);
      if (!view) {
        view = {
          nav,
          path: pathOf(metric.navigationURL, env.landing),
          waiting: new Map(),
          sent: new Set(),
        };
        views.set(key, view);
        if (views.size > MAX_VIEWS) {
          const [oldestKey, oldest] = views.entries().next().value!;
          sendView(oldest);
          views.delete(oldestKey);
        }
      }
      if (view.sent.has(name)) return;
      view.waiting.set(name, value);

      if (env.hidden()) {
        // A browser reports several metrics in a row when the page is hidden. Whoever listens
        // for that calls flush() right after them; this is for when nobody does
        if (!leaving) {
          leaving = true;
          env.later(() => {
            leaving = false;
            flush(true);
          }, 0);
        }
      } else if (views.size > 1 && !settling) {
        settling = true;
        env.later(() => {
          settling = false;
          flush(false);
        }, SETTLE_MS);
      }
    },

    flush: () => flush(true),
  };
}
