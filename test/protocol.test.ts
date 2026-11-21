import { describe, expect, it } from "vitest";
import { bucketOf } from "../src/buckets.js";
import { MAX_ROUTE_LENGTH, parseReport, toCounts, utcDay, type Report } from "../src/protocol.js";

const valid = {
  v: 1,
  route: "/orders/[id]/edit",
  device: "mobile",
  nav: "hard",
  metrics: [
    { name: "LCP", value: 1840 },
    { name: "CLS", value: 0.02 },
  ],
};

function reasonFor(input: unknown) {
  const result = parseReport(input);
  return result.ok ? null : result.reason;
}

describe("parseReport", () => {
  it("accepts a report", () => {
    expect(parseReport(valid)).toEqual({ ok: true, report: valid });
  });

  it("accepts what survives a trip through JSON", () => {
    expect(parseReport(JSON.parse(JSON.stringify(valid))).ok).toBe(true);
  });

  it("leaves behind anything that is not part of a report", () => {
    const result = parseReport({
      ...valid,
      visitor: "abc",
      metrics: [{ name: "INP", value: 96, id: "v5-123", entries: [{}] }],
    });
    expect(result).toEqual({
      ok: true,
      report: { ...valid, metrics: [{ name: "INP", value: 96 }] },
    });
  });

  it.each([null, undefined, "report", 1, [], [valid]])("refuses %j", (input) => {
    expect(reasonFor(input)).toBe("not an object");
  });

  it("refuses another version", () => {
    expect(reasonFor({ ...valid, v: 2 })).toBe("unknown version");
    expect(reasonFor({ ...valid, v: "1" })).toBe("unknown version");
    expect(reasonFor({ ...valid, v: undefined })).toBe("unknown version");
  });

  it.each([
    "/",
    "/pricing",
    "/orders/[id]/edit",
    "/docs/[...slug]",
    "/shop/[[...filters]]",
    "/caf%C3%A9",
    "/a_b-c.d~e",
    "/@team/feed",
  ])("accepts the route %s", (route) => {
    expect(parseReport({ ...valid, route }).ok).toBe(true);
  });

  it.each([
    ["no leading slash", "orders"],
    ["empty", ""],
    ["a query string", "/orders?token=abc"],
    ["a fragment", "/orders#top"],
    ["a full address", "https://example.com/orders"],
    ["a space", "/my page"],
    ["a line break", "/a\nb"],
    ["markup", "/<script>"],
    ["a quote", '/a"b'],
    ["a backslash", "/a\\b"],
    ["letters outside ASCII", "/café"],
    ["too long", "/" + "a".repeat(MAX_ROUTE_LENGTH)],
    ["not a string", 12],
  ])("refuses a route with %s", (_, route) => {
    expect(reasonFor({ ...valid, route })).toBe("invalid route");
  });

  it("accepts a route of exactly the longest length", () => {
    expect(parseReport({ ...valid, route: "/" + "a".repeat(MAX_ROUTE_LENGTH - 1) }).ok).toBe(true);
  });

  it("refuses an unknown device or nav", () => {
    expect(reasonFor({ ...valid, device: "tablet" })).toBe("invalid device");
    expect(reasonFor({ ...valid, device: undefined })).toBe("invalid device");
    expect(reasonFor({ ...valid, nav: "reload" })).toBe("invalid nav");
    expect(reasonFor({ ...valid, nav: null })).toBe("invalid nav");
  });

  it("refuses a report without metrics, or with more than there are", () => {
    expect(reasonFor({ ...valid, metrics: [] })).toBe("invalid metrics");
    expect(reasonFor({ ...valid, metrics: "LCP" })).toBe("invalid metrics");
    expect(reasonFor({ ...valid, metrics: undefined })).toBe("invalid metrics");
    const six = Array.from({ length: 6 }, () => ({ name: "LCP", value: 1 }));
    expect(reasonFor({ ...valid, metrics: six })).toBe("invalid metrics");
  });

  it("refuses an unknown metric and a metric given twice", () => {
    expect(reasonFor({ ...valid, metrics: [{ name: "FID", value: 10 }] })).toBe("unknown metric");
    expect(reasonFor({ ...valid, metrics: [{ name: "__proto__", value: 10 }] })).toBe(
      "unknown metric",
    );
    expect(reasonFor({ ...valid, metrics: ["LCP"] })).toBe("unknown metric");
    expect(reasonFor({ ...valid, metrics: [null] })).toBe("unknown metric");
    expect(
      reasonFor({
        ...valid,
        metrics: [
          { name: "LCP", value: 10 },
          { name: "LCP", value: 20 },
        ],
      }),
    ).toBe("metric given twice");
  });

  it.each([-1, NaN, Infinity, -Infinity, "1840", null, undefined, {}])(
    "refuses the value %j",
    (value) => {
      expect(reasonFor({ ...valid, metrics: [{ name: "LCP", value }] })).toBe("invalid value");
    },
  );

  it("accepts zero and very large values", () => {
    expect(parseReport({ ...valid, metrics: [{ name: "CLS", value: 0 }] }).ok).toBe(true);
    expect(parseReport({ ...valid, metrics: [{ name: "LCP", value: 1e12 }] }).ok).toBe(true);
  });
});

describe("toCounts", () => {
  it("gives one count per metric, in the bucket of its value", () => {
    expect(toCounts(valid as Report, "2026-11-21")).toEqual([
      {
        day: "2026-11-21",
        route: "/orders/[id]/edit",
        device: "mobile",
        nav: "hard",
        metric: "LCP",
        bucket: bucketOf("LCP", 1840),
        count: 1,
      },
      {
        day: "2026-11-21",
        route: "/orders/[id]/edit",
        device: "mobile",
        nav: "hard",
        metric: "CLS",
        bucket: bucketOf("CLS", 0.02),
        count: 1,
      },
    ]);
  });
});

describe("utcDay", () => {
  it("gives the day in UTC", () => {
    expect(utcDay(new Date("2026-11-21T23:59:59.999Z"))).toBe("2026-11-21");
    expect(utcDay(new Date("2026-11-22T00:30:00+01:00"))).toBe("2026-11-21");
    expect(utcDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
