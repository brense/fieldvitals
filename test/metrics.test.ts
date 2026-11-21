import { describe, expect, it } from "vitest";
import { isMetric, METRICS, rate, THRESHOLDS } from "../src/metrics.js";

describe("thresholds", () => {
  it("are the ones the web-vitals library uses", () => {
    expect(THRESHOLDS).toEqual({
      TTFB: { good: 800, poor: 1800 },
      FCP: { good: 1800, poor: 3000 },
      LCP: { good: 2500, poor: 4000 },
      CLS: { good: 0.1, poor: 0.25 },
      INP: { good: 200, poor: 500 },
    });
  });
});

describe("rate", () => {
  it("counts a value on a threshold with the better rating", () => {
    expect(rate("LCP", 0)).toBe("good");
    expect(rate("LCP", 2500)).toBe("good");
    expect(rate("LCP", 2500.1)).toBe("needs-improvement");
    expect(rate("LCP", 4000)).toBe("needs-improvement");
    expect(rate("LCP", 4000.1)).toBe("poor");
    expect(rate("CLS", 0.1)).toBe("good");
    expect(rate("CLS", 0.25)).toBe("needs-improvement");
    expect(rate("CLS", 0.26)).toBe("poor");
  });
});

describe("isMetric", () => {
  it("knows the five metrics and nothing else", () => {
    for (const metric of METRICS) expect(isMetric(metric)).toBe(true);
    for (const other of ["lcp", "FID", "", "constructor", "__proto__", 1, null, undefined]) {
      expect(isMetric(other)).toBe(false);
    }
  });
});
