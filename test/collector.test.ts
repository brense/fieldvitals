import { describe, expect, it } from "vitest";
import { createCollector, type VitalsMetric } from "../src/collector.js";
import { parseReport, type Report } from "../src/protocol.js";

function setup(options: { landing?: string } = {}) {
  const sent: Report[] = [];
  const timers: (() => void)[] = [];
  const state = { hidden: false };
  const collector = createCollector({
    send: (body) => sent.push(JSON.parse(body) as Report),
    device: () => "desktop",
    hidden: () => state.hidden,
    landing: () => options.landing ?? "/",
    later: (run) => timers.push(run),
  });
  return {
    collector,
    sent,
    state,
    /** Runs what was put off */
    tick() {
      for (const run of timers.splice(0)) run();
    },
    timers,
  };
}

const hard = (name: string, value: number, extra: Partial<VitalsMetric> = {}): VitalsMetric => ({
  name,
  value,
  navigationType: "navigate",
  navigationId: 1,
  navigationURL: "https://example.com/orders/8731/edit?tab=2#top",
  ...extra,
});

const soft = (name: string, value: number, id: number, path: string): VitalsMetric => ({
  name,
  value,
  navigationType: "soft-navigation",
  navigationId: id,
  navigationURL: `https://example.com${path}`,
});

describe("createCollector", () => {
  it("sends nothing until asked", () => {
    const { collector, sent } = setup();
    collector.setRoute("/orders/8731/edit", "/orders/[id]/edit");
    collector.report(hard("TTFB", 120));
    collector.report(hard("LCP", 1840));
    expect(sent).toEqual([]);
  });

  it("sends one report per page view, with the route pattern and never the address", () => {
    const { collector, sent } = setup();
    collector.setRoute("/orders/8731/edit", "/orders/[id]/edit");
    collector.report(hard("LCP", 1840));
    collector.report(hard("TTFB", 120));
    collector.report(hard("CLS", 0.02));
    collector.flush();
    expect(sent).toEqual([
      {
        v: 1,
        route: "/orders/[id]/edit",
        device: "desktop",
        nav: "hard",
        metrics: [
          { name: "TTFB", value: 120 },
          { name: "LCP", value: 1840 },
          { name: "CLS", value: 0.02 },
        ],
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain("8731");
    expect(parseReport(sent[0]).ok).toBe(true);
  });

  it("sends a metric once per page view", () => {
    const { collector, sent } = setup();
    collector.setRoute("/orders/8731/edit", "/orders/[id]/edit");
    collector.report(hard("CLS", 0.02));
    collector.flush();
    collector.report(hard("CLS", 0.3));
    collector.report(hard("INP", 96));
    collector.flush();
    collector.flush();
    expect(sent.map((report) => report.metrics)).toEqual([
      [{ name: "CLS", value: 0.02 }],
      [{ name: "INP", value: 96 }],
    ]);
  });

  it("keeps the last value of a metric that changes before it is sent", () => {
    const { collector, sent } = setup();
    collector.setRoute("/orders/8731/edit", "/orders/[id]/edit");
    collector.report(hard("CLS", 0.02));
    collector.report(hard("CLS", 0.08));
    collector.flush();
    expect(sent[0]?.metrics).toEqual([{ name: "CLS", value: 0.08 }]);
  });

  it("ignores what is not a measurement", () => {
    const { collector, sent } = setup();
    collector.setRoute("/orders/8731/edit", "/orders/[id]/edit");
    collector.report(hard("FID", 12));
    collector.report(hard("LCP", Number.NaN));
    collector.report(hard("LCP", -1));
    collector.report(hard("LCP", "1840" as unknown as number));
    collector.flush();
    expect(sent).toEqual([]);
  });

  it("does not count a page restored from the back/forward cache", () => {
    const { collector, sent } = setup();
    collector.setRoute("/orders/8731/edit", "/orders/[id]/edit");
    collector.report(hard("LCP", 30, { navigationType: "back-forward-cache" }));
    collector.flush();
    expect(sent).toEqual([]);
  });

  it("sends what arrives while the page is hidden in one report", () => {
    const { collector, sent, state, tick, timers } = setup();
    collector.setRoute("/orders/8731/edit", "/orders/[id]/edit");
    collector.report(hard("TTFB", 120));
    state.hidden = true;
    // What a browser does when the page is hidden: the last values, one after the other
    collector.report(hard("LCP", 1840));
    collector.report(hard("CLS", 0.02));
    collector.report(hard("INP", 96));
    expect(sent).toEqual([]);
    expect(timers).toHaveLength(1);
    collector.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.metrics.map((metric) => metric.name)).toEqual(["TTFB", "LCP", "CLS", "INP"]);
    tick();
    expect(sent).toHaveLength(1);
  });

  it("sends by itself when the page is hidden and nobody asks", () => {
    const { collector, sent, state, tick } = setup();
    collector.setRoute("/orders/8731/edit", "/orders/[id]/edit");
    state.hidden = true;
    collector.report(hard("TTFB", 120));
    collector.report(hard("LCP", 1840));
    expect(sent).toEqual([]);
    tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.metrics.map((metric) => metric.name)).toEqual(["TTFB", "LCP"]);
    collector.report(hard("CLS", 0.02));
    tick();
    expect(sent).toHaveLength(2);
  });

  it("keeps page views in one document apart", () => {
    const { collector, sent } = setup();
    collector.setRoute("/", "/");
    collector.report(hard("TTFB", 120, { navigationURL: "https://example.com/" }));
    collector.report(hard("FCP", 300, { navigationURL: "https://example.com/" }));
    // What a click on a link gives: the new page view starts, the old one gets its last values
    collector.report(soft("FCP", 90, 2, "/orders/8731/edit"));
    collector.report(hard("LCP", 300, { navigationURL: "https://example.com/" }));
    collector.report(hard("CLS", 0, { navigationURL: "https://example.com/" }));
    collector.setRoute("/orders/8731/edit", "/orders/[id]/edit");
    collector.report(soft("LCP", 90, 2, "/orders/8731/edit"));
    collector.flush();
    expect(sent).toEqual([
      {
        v: 1,
        route: "/",
        device: "desktop",
        nav: "hard",
        metrics: [
          { name: "TTFB", value: 120 },
          { name: "FCP", value: 300 },
          { name: "LCP", value: 300 },
          { name: "CLS", value: 0 },
        ],
      },
      {
        v: 1,
        route: "/orders/[id]/edit",
        device: "desktop",
        nav: "soft",
        metrics: [
          { name: "FCP", value: 90 },
          { name: "LCP", value: 90 },
        ],
      },
    ]);
  });

  it("sends a page view that was left a little later, without waiting for the page to hide", () => {
    const { collector, sent, tick, timers } = setup();
    collector.setRoute("/", "/");
    collector.report(hard("TTFB", 120, { navigationURL: "https://example.com/" }));
    expect(timers).toHaveLength(0);
    collector.report(soft("FCP", 90, 2, "/pricing"));
    collector.report(hard("CLS", 0, { navigationURL: "https://example.com/" }));
    expect(timers).toHaveLength(1);
    expect(sent).toEqual([]);
    tick();
    expect(sent.map((report) => report.route)).toEqual(["/"]);
    // The page view that is still open waits
    collector.setRoute("/pricing", "/pricing");
    collector.flush();
    expect(sent.map((report) => report.route)).toEqual(["/", "/pricing"]);
  });

  it("waits for the route of a path, and sends nothing for a path without one", () => {
    const { collector, sent } = setup();
    collector.report(hard("LCP", 1840));
    collector.flush();
    expect(sent).toEqual([]);
    collector.setRoute("/orders/8731/edit/", "/orders/[id]/edit");
    collector.flush();
    expect(sent).toHaveLength(1);

    const other = setup();
    other.collector.setRoute("/orders/8731/edit", null);
    other.collector.report(hard("LCP", 1840));
    other.collector.flush();
    other.collector.setRoute("/orders/8731/edit", "/orders/[id]/edit");
    other.collector.flush();
    expect(other.sent).toEqual([]);
  });

  it("uses the path the document was loaded with when a measurement has no address", () => {
    const { collector, sent } = setup({ landing: "/pricing/" });
    collector.setRoute("/pricing", "/pricing");
    collector.report({ name: "LCP", value: 900 });
    collector.flush();
    expect(sent.map((report) => [report.route, report.nav])).toEqual([["/pricing", "hard"]]);
  });

  it("forgets the oldest page views in a very long visit, after sending them", () => {
    const { collector, sent } = setup();
    for (let id = 1; id <= 30; id++) {
      collector.setRoute(`/p/${id}`, "/p/[id]");
      collector.report(soft("LCP", 100, id, `/p/${id}`));
    }
    expect(sent).toHaveLength(10);
    collector.flush();
    expect(sent).toHaveLength(30);
  });
});
