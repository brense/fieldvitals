import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the router says about the page that is shown; each test sets it */
const router = vi.hoisted(() => ({
  pathname: "/" as string | null,
  params: {} as Record<string, string | string[]> | null,
  segments: [] as string[] | null,
  report: undefined as ((metric: Record<string, unknown>) => void) | undefined,
}));

vi.mock("next/navigation.js", () => ({
  usePathname: () => router.pathname,
  useParams: () => router.params,
  useSelectedLayoutSegments: () => router.segments,
}));
vi.mock("next/web-vitals.js", () => ({
  useReportWebVitals: (report: (metric: Record<string, unknown>) => void) => {
    router.report = report;
  },
}));
// Effects do not run when rendering to a string; here they run right away
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (run: () => void) => void run(),
}));

type Page = {
  /** What the address bar shows */
  address: string;
  pathname?: string | null;
  params?: Record<string, string | string[]> | null;
  segments: string[] | null;
};

let sent: { endpoint: string; body: string }[];
let visibility: "visible" | "hidden";
let listeners: (() => void)[];

beforeEach(() => {
  vi.resetModules();
  sent = [];
  visibility = "visible";
  listeners = [];
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (Linux; Android 16) Mobile",
    sendBeacon: (endpoint: string, body: string) => sent.push({ endpoint, body }) > 0,
  });
  vi.stubGlobal("document", {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
  });
});

afterEach(() => vi.unstubAllGlobals());

/** Shows a page, measures it, hides the tab and gives back what was sent */
async function visit(page: Page, props: { endpoint?: string; sampleRate?: number } = {}) {
  const { FieldVitals } = await import("../src/next.js");
  vi.stubGlobal("location", { pathname: page.address });
  router.pathname = page.pathname === undefined ? page.address : page.pathname;
  router.params = page.params === undefined ? {} : page.params;
  router.segments = page.segments;
  renderToStaticMarkup(<FieldVitals {...props} />);
  router.report!({ name: "LCP", value: 1840, navigationType: "navigate" });
  visibility = "hidden";
  for (const listener of listeners) listener();
  return sent.map(({ endpoint, body }) => ({ endpoint, ...JSON.parse(body) }));
}

describe("FieldVitals", () => {
  it("sends one report with the route pattern to the site's own endpoint", async () => {
    const reports = await visit({
      address: "/orders/8731/edit",
      params: { id: "8731" },
      segments: ["orders", "8731", "edit"],
    });
    expect(reports).toEqual([
      {
        endpoint: "/api/vitals",
        v: 1,
        route: "/orders/[id]/edit",
        device: "mobile",
        nav: "hard",
        metrics: [{ name: "LCP", value: 1840 }],
      },
    ]);
  });

  it("uses the endpoint it is given", async () => {
    const reports = await visit({ address: "/", segments: [] }, { endpoint: "/rum" });
    expect(reports.map((report) => [report.endpoint, report.route])).toEqual([["/rum", "/"]]);
  });

  it("leaves route groups out of the pattern", async () => {
    const reports = await visit({ address: "/about", segments: ["(marketing)", "about"] });
    expect(reports.map((report) => report.route)).toEqual(["/about"]);
  });

  it("never sends the address after a rewrite to a page without parameters", async () => {
    const reports = await visit({ address: "/share/s3cr3t-token", segments: ["shared"] });
    expect(reports.map((report) => report.route)).toEqual(["/shared"]);
    expect(JSON.stringify(sent)).not.toContain("s3cr3t");
  });

  it("names a rewrite to a page with parameters after that page", async () => {
    const reports = await visit({
      address: "/u/alice",
      params: { slug: "alice" },
      segments: ["blog", "alice"],
    });
    expect(reports.map((report) => report.route)).toEqual(["/blog/[slug]"]);
  });

  it("reports an address that matches nothing as /_not-found", async () => {
    const reports = await visit({ address: "/no/such/page", segments: ["/_not-found"] });
    expect(reports.map((report) => report.route)).toEqual(["/_not-found"]);
    expect(JSON.stringify(sent)).not.toContain("such");
  });

  it("sends nothing when the pattern is not known", async () => {
    // A parameter the tree does not hold
    expect(await visit({ address: "/feed", params: { id: "12" }, segments: ["feed"] })).toEqual([]);
  });

  it("sends nothing outside the App Router", async () => {
    expect(
      await visit({ address: "/orders/8731", pathname: null, params: null, segments: null }),
    ).toEqual([]);
  });

  it("measures the share of page loads it is given", async () => {
    expect(await visit({ address: "/", segments: [] }, { sampleRate: 0 })).toEqual([]);
  });
});
