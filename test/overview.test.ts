import { describe, expect, it } from "vitest";
import { bucketOf } from "../src/buckets.js";
import { evaluate } from "../src/evaluate.js";
import type { Metric } from "../src/metrics.js";
import { daysOf, overview } from "../src/overview.js";
import type { BucketCount, Device, Navigation } from "../src/protocol.js";
import { memoryStore } from "../src/store/memory.js";

const now = () => new Date("2026-11-21T10:00:00Z");

function counts(
  day: string,
  route: string,
  metric: Metric,
  value: number,
  count: number,
  extra: { device?: Device; nav?: Navigation } = {},
): BucketCount {
  return {
    day,
    route,
    device: extra.device ?? "mobile",
    nav: extra.nav ?? "hard",
    metric,
    bucket: bucketOf(metric, value),
    count,
  };
}

describe("daysOf", () => {
  it("counts back from today in UTC, the last day included", () => {
    expect(daysOf({ days: 3, now }, 28)).toEqual(["2026-11-19", "2026-11-20", "2026-11-21"]);
    expect(daysOf({ now }, 28)).toHaveLength(28);
    expect(daysOf({ days: 1, to: "2027-01-01" }, 28)).toEqual(["2027-01-01"]);
    expect(daysOf({ days: 2, to: "2027-03-01" }, 28)).toEqual(["2027-02-28", "2027-03-01"]);
  });

  it("keeps the number of days within bounds", () => {
    expect(daysOf({ days: 0, now }, 28)).toHaveLength(1);
    expect(daysOf({ days: -5, now }, 28)).toHaveLength(1);
    expect(daysOf({ days: 100_000, now }, 28)).toHaveLength(366);
    expect(daysOf({ days: Number.NaN, now }, 28)).toHaveLength(28);
    expect(daysOf({ days: 2.9, now }, 28)).toHaveLength(2);
  });

  it("refuses a last day that is not a date", () => {
    expect(() => daysOf({ to: "yesterday" }, 28)).toThrow(TypeError);
    expect(() => daysOf({ to: "2026-13-45" }, 28)).toThrow(TypeError);
    // These parse, as 3 March and 1 May
    expect(() => daysOf({ to: "2026-02-31" }, 28)).toThrow(TypeError);
    expect(() => daysOf({ to: "2026-04-31" }, 28)).toThrow(TypeError);
    expect(daysOf({ days: 1, to: "2028-02-29" }, 28)).toEqual(["2028-02-29"]);
  });
});

describe("overview", () => {
  async function filled() {
    const store = memoryStore();
    await store.add([
      counts("2026-11-20", "/", "LCP", 1000, 30),
      counts("2026-11-21", "/", "LCP", 5000, 10),
      counts("2026-11-21", "/", "CLS", 0.05, 8),
      counts("2026-11-21", "/orders/[id]", "LCP", 3000, 5, { device: "desktop" }),
      counts("2026-11-21", "/orders/[id]", "INP", 100, 50, { device: "desktop", nav: "soft" }),
      // Outside the period
      counts("2026-11-01", "/", "LCP", 9000, 1000),
    ]);
    return store;
  }

  it("is empty for an empty store, with every day present", async () => {
    const result = await overview(memoryStore(), { days: 3, now });
    expect(result.period).toEqual({ from: "2026-11-19", to: "2026-11-21" });
    expect(result.metrics.LCP).toEqual({
      count: 0,
      p75: null,
      rating: null,
      good: 0,
      needsImprovement: 0,
      poor: 0,
    });
    expect(result.trend.map((entry) => entry.day)).toEqual([
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
    ]);
    expect(result.routes).toEqual([]);
  });

  it("sums up the period, per day and per route", async () => {
    const result = await overview(await filled(), { days: 7, now });
    expect(result.metrics.LCP.count).toBe(45);
    expect(result.metrics.LCP).toMatchObject({ good: 30, needsImprovement: 5, poor: 10 });
    expect(result.metrics.INP.count).toBe(50);
    expect(result.metrics.TTFB.count).toBe(0);
    expect(result.trend).toHaveLength(7);
    expect(result.trend.map((entry) => entry.metrics.LCP.count)).toEqual([0, 0, 0, 0, 0, 30, 15]);
    expect(result.trend[5]?.metrics.LCP.rating).toBe("good");
    expect(result.routes.map((entry) => [entry.route, entry.samples])).toEqual([
      ["/orders/[id]", 50],
      ["/", 40],
    ]);
    expect(result.routes[1]?.metrics.LCP.count).toBe(40);
  });

  it("filters on route, device and navigation, and keeps listing every route", async () => {
    const store = await filled();
    const home = await overview(store, { days: 7, now, route: "/" });
    expect(home.metrics.LCP.count).toBe(40);
    expect(home.metrics.INP.count).toBe(0);
    expect(home.routes.map((entry) => entry.route)).toEqual(["/orders/[id]", "/"]);

    const desktop = await overview(store, { days: 7, now, device: "desktop" });
    expect(desktop.metrics.LCP.count).toBe(5);
    expect(desktop.routes.map((entry) => entry.route)).toEqual(["/orders/[id]"]);

    const soft = await overview(store, { days: 7, now, nav: "soft" });
    expect(soft.metrics.LCP.count).toBe(0);
    expect(soft.metrics.INP.count).toBe(50);
  });

  it("creates what the store needs before reading", async () => {
    const inner = memoryStore();
    let migrated = false;
    await overview({ ...inner, migrate: async () => void (migrated = true) }, { now });
    expect(migrated).toBe(true);
  });
});

describe("evaluate", () => {
  it("finds nothing in an empty store or a healthy one", async () => {
    expect(await evaluate(memoryStore(), { now })).toEqual([]);
    const store = memoryStore();
    await store.add([counts("2026-11-21", "/", "LCP", 1200, 500)]);
    expect(await evaluate(store, { now })).toEqual([]);
  });

  it("reports a poor 75th percentile for the site and per route", async () => {
    const store = memoryStore();
    await store.add([
      counts("2026-11-21", "/slow", "LCP", 6000, 60),
      counts("2026-11-20", "/fast", "LCP", 1000, 40),
      counts("2026-11-21", "/fast", "INP", 90, 40),
    ]);
    const findings = await evaluate(store, { now });
    expect(findings.map((finding) => [finding.route, finding.metric, finding.rating])).toEqual([
      [null, "LCP", "poor"],
      ["/slow", "LCP", "poor"],
    ]);
    const [site] = findings;
    expect(site).toMatchObject({
      count: 100,
      threshold: 4000,
      period: { from: "2026-11-15", to: "2026-11-21" },
    });
    expect(site!.p75).toBeGreaterThan(4000);
  });

  it("leaves out what has too few measurements", async () => {
    const store = memoryStore();
    await store.add([counts("2026-11-21", "/slow", "LCP", 6000, 19)]);
    expect(await evaluate(store, { now })).toEqual([]);
    expect(await evaluate(store, { now, minSamples: 19 })).toHaveLength(2);
  });

  it("reports what needs improvement only when asked", async () => {
    const store = memoryStore();
    await store.add([counts("2026-11-21", "/meh", "CLS", 0.2, 30)]);
    expect(await evaluate(store, { now })).toEqual([]);
    const findings = await evaluate(store, { now, level: "needs-improvement" });
    expect(findings.map((finding) => [finding.route, finding.rating, finding.threshold])).toEqual([
      [null, "needs-improvement", 0.1],
      ["/meh", "needs-improvement", 0.1],
    ]);
  });

  it("looks at the period and the visitors it is asked about", async () => {
    const store = memoryStore();
    await store.add([
      counts("2026-11-10", "/slow", "LCP", 6000, 60),
      counts("2026-11-21", "/slow", "LCP", 6000, 60, { device: "desktop" }),
    ]);
    expect(await evaluate(store, { now, device: "mobile" })).toEqual([]);
    expect(await evaluate(store, { now, device: "mobile", days: 28 })).toHaveLength(2);
    expect(await evaluate(store, { now, days: 1, to: "2026-11-10" })).toHaveLength(2);
  });
});
