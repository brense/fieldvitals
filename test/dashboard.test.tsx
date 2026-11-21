import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bucketCount, bucketOf, bucketRange } from "../src/buckets.js";
import { Dashboard, DashboardView, filtersFrom } from "../src/dashboard.js";
import { formatCount, formatDay, formatValue, hrefWith, shares } from "../src/dashboard/format.js";
import type { Metric } from "../src/metrics.js";
import { overview } from "../src/overview.js";
import type { BucketCount } from "../src/protocol.js";
import { memoryStore } from "../src/store/memory.js";

const now = () => new Date("2026-11-21T10:00:00Z");

function counts(day: string, route: string, metric: Metric, value: number, count: number) {
  const bucket = bucketOf(metric, value);
  return { day, route, device: "mobile", nav: "hard", metric, bucket, count } as BucketCount;
}

async function filled() {
  const store = memoryStore();
  await store.add([
    counts("2026-11-19", "/", "LCP", 1200, 300),
    counts("2026-11-20", "/", "LCP", 1400, 900),
    counts("2026-11-21", "/", "LCP", 5200, 34),
    counts("2026-11-21", "/", "CLS", 0.18, 60),
    counts("2026-11-21", "/orders/[id]/edit", "INP", 640, 12),
    counts("2026-11-21", '/a<b>&"c', "TTFB", 300, 3),
  ]);
  return store;
}

describe("formatting", () => {
  it("writes times in ms or s and CLS without a unit", () => {
    expect(formatValue("LCP", 320.4)).toBe("320 ms");
    expect(formatValue("LCP", 1840)).toBe("1.84 s");
    expect(formatValue("TTFB", 999.6)).toBe("1.00 s");
    expect(formatValue("CLS", 0.1234)).toBe("0.12");
    expect(formatValue("CLS", 0.0075)).toBe("< 0.01");
    expect(formatValue("CLS", 0.01)).toBe("0.01");
  });

  it("never shows a threshold for a value that is past it", () => {
    expect(formatValue("LCP", 2500)).toBe("2.50 s");
    expect(formatValue("LCP", 2500.4)).toBe("2.51 s");
    expect(formatValue("LCP", 4003)).toBe("4.01 s");
    expect(formatValue("INP", 200.3)).toBe("201 ms");
    expect(formatValue("INP", 200)).toBe("200 ms");
    expect(formatValue("TTFB", 800.2)).toBe("801 ms");
    expect(formatValue("CLS", 0.1)).toBe("0.10");
    expect(formatValue("CLS", 0.1004)).toBe("0.11");
    expect(formatValue("CLS", 0.2501)).toBe("0.26");
    // Away from a threshold, rounding is the usual kind
    expect(formatValue("LCP", 3004.9)).toBe("3.00 s");
    expect(formatValue("LCP", 2499.6)).toBe("2.50 s");
    expect(formatValue("LCP", 1234.4)).toBe("1.23 s");
  });

  it("marks a value in the open bucket as at least that much", () => {
    for (const metric of ["TTFB", "FCP", "LCP", "CLS", "INP"] as const) {
      const { min } = bucketRange(metric, bucketCount(metric) - 1);
      expect(formatValue(metric, min)).toMatch(/^≥ /);
      expect(formatValue(metric, min * 0.9)).not.toMatch(/≥/);
    }
  });

  it("writes counts and days the same way everywhere", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatDay("2026-11-01")).toBe("1 Nov 2026");
  });

  it("gives whole percentages that add up to 100", () => {
    expect(shares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(shares([999, 1, 0])).toEqual([100, 0, 0]);
    expect(shares([1, 0, 0])).toEqual([100, 0, 0]);
    expect(shares([0, 0, 0])).toEqual([0, 0, 0]);
    for (const parts of [
      [3, 3, 1],
      [17, 29, 31],
      [1, 2, 4],
    ]) {
      expect(shares(parts).reduce((sum, part) => sum + part, 0)).toBe(100);
    }
  });

  it("reads filters from the address and ignores what it does not know", () => {
    expect(filtersFrom({}, 28)).toEqual({ days: 28 });
    expect(filtersFrom({ days: "7", device: "mobile", nav: "soft", route: "/a" }, 28)).toEqual({
      days: 7,
      device: "mobile",
      nav: "soft",
      route: "/a",
    });
    expect(filtersFrom({ days: "100000", device: "tv", nav: ["hard", "soft"] }, 28)).toEqual({
      days: 28,
      nav: "hard",
    });
    expect(filtersFrom({ route: "/".padEnd(300, "x") }, 28).route).toBeUndefined();
  });

  it("makes links that change one filter and keep the rest", () => {
    expect(hrefWith({ days: "7", tab: "vitals" }, { device: "mobile" })).toBe(
      "?days=7&tab=vitals&device=mobile",
    );
    expect(hrefWith({ days: "7", device: "mobile" }, { device: undefined })).toBe("?days=7");
    expect(hrefWith({ tag: ["a", "b"] }, { route: "/orders/[id]" })).toBe(
      "?tag=a&tag=b&route=%2Forders%2F%5Bid%5D",
    );
    expect(hrefWith({}, { device: undefined })).toBe("?");
    // A parameter that happens to be named like something every object has
    expect(hrefWith({ toString: "1", days: "7" }, { device: "mobile" })).toBe(
      "?toString=1&days=7&device=mobile",
    );
  });
});

describe("Dashboard", () => {
  it("shows the 75th percentile, the rating in words and the spread per metric", async () => {
    const html = renderToStaticMarkup(await Dashboard({ store: await filled(), now }));
    expect(html).toContain("Web vitals");
    expect(html).toContain("25 Oct 2026 to 21 Nov 2026");
    expect(html).toContain("Largest Contentful Paint");
    // 1200 of 1234 LCP measurements were good
    expect(html).toContain("97% good, 0% needs improvement, 3% poor");
    expect(html).toContain("1,234 measurements");
    expect(html).toMatch(/fv-rating fv-good"><span[^>]*><\/span>Good/);
    expect(html).toMatch(/fv-rating fv-needs-improvement"><span[^>]*><\/span>Needs improvement/);
    expect(html).toMatch(/fv-rating fv-poor"><span[^>]*><\/span>Poor/);
    expect(html).toContain("No measurements");
    expect(html).toContain("Nothing measured in this period");
    expect(html).toContain('<span class="fv-few">few</span>');
  });

  it("lists the routes, most measured first, with links that filter on one", async () => {
    const html = renderToStaticMarkup(await Dashboard({ store: await filled(), now }));
    const home = html.indexOf("<code>/</code>");
    const orders = html.indexOf("<code>/orders/[id]/edit</code>");
    expect(home).toBeGreaterThan(-1);
    expect(orders).toBeGreaterThan(home);
    expect(html).toContain('href="?route=%2Forders%2F%5Bid%5D%2Fedit"');
    expect(html).toContain("few measurements");
  });

  it("escapes whatever a route holds", async () => {
    const html = renderToStaticMarkup(await Dashboard({ store: await filled(), now }));
    expect(html).not.toContain("<b>");
    expect(html).toContain("/a&lt;b&gt;&amp;&quot;c");
  });

  it("follows the filters in the address, given as they are or as a promise", async () => {
    const store = await filled();
    const searchParams = { days: "1", route: "/orders/[id]/edit", tab: "vitals" };
    const html = renderToStaticMarkup(
      await Dashboard({ store, now, searchParams: Promise.resolve(searchParams) }),
    );
    expect(html).toContain("21 Nov 2026 (UTC)");
    expect(html).toContain("Showing <code>/orders/[id]/edit</code> only.");
    expect(html).toContain('href="?days=1&amp;tab=vitals"');
    expect(html).toMatch(/aria-current="true"[^>]*>Today</);
    expect(html).toContain('href="?route=%2Forders%2F%5Bid%5D%2Fedit&amp;tab=vitals&amp;days=7"');
    // Only INP was measured on that route
    expect(html).toContain("12 measurements");
    expect(html).not.toContain("1,234 measurements");
    expect(html).toBe(renderToStaticMarkup(await Dashboard({ store, now, searchParams })));
  });

  it("works for a store without measurements", async () => {
    const html = renderToStaticMarkup(await Dashboard({ store: memoryStore(), now, days: 7 }));
    expect(html).toContain("No measurements in this period yet.");
    expect(html).not.toContain("<table");
    expect(html).toMatch(/aria-current="true"[^>]*>7 days</);
  });

  it("leaves the heading out for a page that has its own", async () => {
    const withHeading = renderToStaticMarkup(await Dashboard({ store: memoryStore(), now }));
    expect(withHeading).toContain('<h2 class="fv-title">Web vitals</h2>');
    const without = renderToStaticMarkup(
      await Dashboard({ store: memoryStore(), now, title: null }),
    );
    expect(without).not.toContain('fv-title"');
  });

  it("sends its styles along once and no script", async () => {
    const html = renderToStaticMarkup(
      await Dashboard({ store: await filled(), now, title: "Speed" }),
    );
    expect(html).toContain("Speed");
    expect(html.match(/<style/g)).toHaveLength(1);
    expect(html).toContain(".fv-card");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("prefers-color-scheme");
  });
});

describe("DashboardView", () => {
  it("draws the course per day and leaves gaps where nothing was measured", async () => {
    const store = memoryStore();
    await store.add([
      counts("2026-11-17", "/", "LCP", 1000, 30),
      counts("2026-11-18", "/", "LCP", 1100, 30),
      counts("2026-11-21", "/", "LCP", 3000, 30),
    ]);
    const data = await overview(store, { days: 7, now });
    const html = renderToStaticMarkup(<DashboardView data={data} filters={{ days: 7 }} />);
    const path = /<path d="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path.match(/L/g)).toHaveLength(1);
    expect(path).toContain("h0.01");
    expect(html).toMatch(/aria-label="75th percentile per day, most recently [\d.]+ s"/);
  });

  it("stops the table at a hundred routes and says so", async () => {
    const store = memoryStore();
    await store.add(
      Array.from({ length: 130 }, (_, index) =>
        counts("2026-11-21", `/page-${index}`, "LCP", 1000, 130 - index),
      ),
    );
    const data = await overview(store, { days: 1, now });
    const html = renderToStaticMarkup(<DashboardView data={data} filters={{ days: 1 }} />);
    expect(html.match(/<tr/g)).toHaveLength(101);
    expect(html).toContain("The 100 most visited of 130 routes.");
    expect(html).toContain("<code>/page-99</code>");
    expect(html).not.toContain("<code>/page-100</code>");
  });
});
