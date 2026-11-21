import { describe, expect, it } from "vitest";
import { OTHER_ROUTE, createHandler, type HandlerOptions } from "../src/handler.js";
import { memoryStore } from "../src/store/memory.js";
import type { Store } from "../src/store.js";

const BROWSER =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const DAY = "2026-11-21";
const period = { from: DAY, to: DAY };

const report = (route = "/orders/[id]/edit") => ({
  v: 1,
  route,
  device: "mobile",
  nav: "hard",
  metrics: [
    { name: "LCP", value: 1840 },
    { name: "CLS", value: 0.02 },
  ],
});

function post(body: unknown, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return new Request("https://example.com/api/vitals", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "sec-fetch-site": "same-origin", "user-agent": BROWSER, ...headers },
    ...init,
  });
}

function setup(options: Partial<HandlerOptions> = {}) {
  const store = options.store ?? memoryStore();
  const handle = createHandler({ now: () => new Date(`${DAY}T10:00:00Z`), ...options, store });
  const total = async () =>
    (await store.read(period)).reduce((sum, reading) => sum + reading.count, 0);
  return { store, handle, total };
}

describe("createHandler", () => {
  it("stores the counts of a report and answers without content", async () => {
    const { store, handle } = setup();
    const response = await handle(post(report()));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    const rows = await store.read({ ...period, by: ["day", "route", "device", "nav"] });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.day, row.route, row.device, row.nav, row.count])).toEqual([
      [DAY, "/orders/[id]/edit", "mobile", "hard", 1],
      [DAY, "/orders/[id]/edit", "mobile", "hard", 1],
    ]);
  });

  it("reads the body whatever content type it has, as sendBeacon sends text", async () => {
    const { handle, total } = setup();
    const response = await handle(post(report(), { "content-type": "text/plain;charset=UTF-8" }));
    expect(response.status).toBe(204);
    expect(await total()).toBe(2);
  });

  it("creates what the store needs, once", async () => {
    const inner = memoryStore();
    let migrations = 0;
    const store: Store = { ...inner, migrate: async () => void migrations++ };
    const { handle } = setup({ store });
    await handle(post(report()));
    await handle(post(report()));
    expect(migrations).toBe(1);
  });

  it("only takes POST", async () => {
    const { handle } = setup();
    const response = await handle(new Request("https://example.com/api/vitals"));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  describe("same origin", () => {
    it("refuses what a browser marks as coming from elsewhere", async () => {
      const { handle, total } = setup();
      for (const site of ["cross-site", "same-site", "none"]) {
        expect((await handle(post(report(), { "sec-fetch-site": site }))).status).toBe(403);
      }
      expect(await total()).toBe(0);
    });

    it("falls back on Origin for browsers that do not say", async () => {
      const { handle } = setup();
      const from = (headers: Record<string, string>) =>
        handle(
          new Request("https://internal:3000/api/vitals", {
            method: "POST",
            body: JSON.stringify(report()),
            headers: { "user-agent": BROWSER, ...headers },
          }),
        ).then((response) => response.status);
      expect(await from({ origin: "https://internal:3000" })).toBe(204);
      expect(await from({ origin: "https://example.com", host: "example.com" })).toBe(204);
      expect(
        await from({
          origin: "https://example.com",
          host: "internal:3000",
          "x-forwarded-host": "example.com, proxy.internal",
        }),
      ).toBe(204);
      expect(await from({ origin: "https://evil.example", host: "example.com" })).toBe(403);
      // The same site written differently: capitals, and the port a scheme has anyway
      expect(await from({ origin: "https://example.com", host: "Example.COM" })).toBe(204);
      expect(await from({ origin: "https://example.com", host: "example.com:443" })).toBe(204);
      expect(await from({ origin: "http://example.com", host: "example.com:80" })).toBe(204);
      expect(await from({ origin: "https://example.com", host: "example.com:8443" })).toBe(403);
      expect(await from({ origin: "https://example.com", host: "example.com.evil.example" })).toBe(
        403,
      );
      expect(await from({ origin: "null", host: "example.com" })).toBe(403);
      expect(await from({})).toBe(403);
    });
  });

  it("refuses what is not a report, with the reason", async () => {
    const { handle, total } = setup();
    const notJson = await handle(post("{"));
    expect([notJson.status, await notJson.text()]).toEqual([400, "not JSON"]);
    const empty = await handle(post(""));
    expect(empty.status).toBe(400);
    const wrong = await handle(post({ ...report(), route: "/orders/8731?x=1" }));
    expect([wrong.status, await wrong.text()]).toEqual([400, "invalid route"]);
    expect(await total()).toBe(0);
  });

  it("refuses a body that is larger than a report can be", async () => {
    const { handle, total } = setup();
    const large = JSON.stringify({ ...report(), padding: "x".repeat(3000) });
    expect((await handle(post(large))).status).toBe(413);
    // Without a Content-Length to go by
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode("x".repeat(1000));
        for (let index = 0; index < 5; index++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const streamed = post(stream as unknown as string, {}, {
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await handle(streamed)).status).toBe(413);
    expect(await total()).toBe(0);
  });

  it("leaves out crawlers and test tools, without telling them", async () => {
    const { handle, total } = setup();
    const agents = [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Linux; Android 11; moto g power) Chrome/151.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
      "",
    ];
    for (const agent of agents) {
      expect((await handle(post(report(), { "user-agent": agent }))).status).toBe(204);
    }
    expect(await total()).toBe(0);

    const all = setup({ ignoreBots: false });
    await all.handle(post(report(), { "user-agent": agents[1]! }));
    expect(await all.total()).toBe(2);
  });

  it("counts routes beyond the maximum of a day as (other)", async () => {
    const { store, handle } = setup({ maxRoutes: 2 });
    for (const route of ["/a", "/b", "/c", "/d", "/a"]) await handle(post(report(route)));
    expect(await store.routes(period)).toEqual([OTHER_ROUTE, "/a", "/b"]);
    const other = await store.read({ ...period, route: OTHER_ROUTE });
    expect(other.reduce((sum, reading) => sum + reading.count, 0)).toBe(4);
  });

  it("counts the routes a day already has towards the maximum, and starts over the next day", async () => {
    const store = memoryStore();
    await store.add([
      { day: DAY, route: "/a", device: "mobile", nav: "hard", metric: "LCP", bucket: 3, count: 1 },
      { day: DAY, route: "/b", device: "mobile", nav: "hard", metric: "LCP", bucket: 3, count: 1 },
    ]);
    let moment = new Date(`${DAY}T10:00:00Z`);
    const { handle } = setup({ store, maxRoutes: 2, now: () => moment });
    await handle(post(report("/c")));
    expect(await store.routes(period)).toEqual([OTHER_ROUTE, "/a", "/b"]);
    moment = new Date("2026-11-22T00:00:01Z");
    await handle(post(report("/c")));
    expect(await store.routes({ from: "2026-11-22", to: "2026-11-22" })).toEqual(["/c"]);
  });

  it("does not let a route whose counts were not stored take a place", async () => {
    const inner = memoryStore();
    let broken = true;
    const store: Store = {
      ...inner,
      async add(counts) {
        if (broken) throw new Error("database is gone");
        return inner.add(counts);
      },
    };
    const { handle } = setup({ store, maxRoutes: 1 });
    expect((await handle(post(report("/a")))).status).toBe(500);
    broken = false;
    await handle(post(report("/b")));
    await handle(post(report("/a")));
    expect(await store.routes(period)).toEqual([OTHER_ROUTE, "/b"]);
  });

  it("limits the number of reports per minute", async () => {
    let moment = new Date(`${DAY}T10:00:00Z`);
    const { handle, total } = setup({ maxPerMinute: 2, now: () => moment });
    const statuses = [];
    for (let index = 0; index < 4; index++) statuses.push((await handle(post(report()))).status);
    expect(statuses).toEqual([204, 204, 429, 429]);
    moment = new Date(`${DAY}T10:01:00Z`);
    expect((await handle(post(report()))).status).toBe(204);
    expect(await total()).toBe(6);
  });

  it("answers 500 and tells onError when the store fails, and works again when the store does", async () => {
    const inner = memoryStore();
    let broken = true;
    const store: Store = {
      ...inner,
      async add(counts) {
        if (broken) throw new Error("database is gone");
        return inner.add(counts);
      },
    };
    const errors: unknown[] = [];
    const { handle, total } = setup({ store, onError: (error) => errors.push(error) });
    const response = await handle(post(report()));
    expect([response.status, await response.text()]).toEqual([500, "could not store"]);
    expect(errors).toHaveLength(1);
    broken = false;
    expect((await handle(post(report()))).status).toBe(204);
    expect(await total()).toBe(2);
  });

  it("tries the migration again after it failed", async () => {
    const inner = memoryStore();
    let attempts = 0;
    const store: Store = {
      ...inner,
      async migrate() {
        if (++attempts === 1) throw new Error("locked");
      },
    };
    const { handle } = setup({ store, onError: () => {} });
    expect((await handle(post(report()))).status).toBe(500);
    expect((await handle(post(report()))).status).toBe(204);
  });

  describe("keepDays", () => {
    const old = (day: string) => [
      {
        day,
        route: "/",
        device: "mobile",
        nav: "hard",
        metric: "LCP",
        bucket: 3,
        count: 1,
      } as const,
    ];
    function pruning(options: Partial<HandlerOptions> = {}) {
      const inner = memoryStore();
      const pruned: string[] = [];
      const store: Store = {
        ...inner,
        async prune(day) {
          pruned.push(day);
          return inner.prune(day);
        },
      };
      let moment = new Date(`${DAY}T10:00:00Z`);
      const { handle } = setup({ store, now: () => moment, ...options });
      return { inner, pruned, handle, at: (iso: string) => (moment = new Date(iso)) };
    }

    it("removes days older than 400 days, once a day", async () => {
      const { inner, pruned, handle, at } = pruning();
      await inner.add([...old("2025-10-16"), ...old("2025-10-17")]);
      await handle(post(report()));
      await handle(post(report()));
      expect(pruned).toEqual(["2025-10-17"]);
      expect(await inner.read({ from: "2025-01-01", to: "2025-12-31" })).toHaveLength(1);
      at("2026-11-22T00:00:05Z");
      await handle(post(report()));
      expect(pruned).toEqual(["2025-10-17", "2025-10-18"]);
    });

    it("keeps the number of days it is given", async () => {
      const { pruned, handle } = pruning({ keepDays: 30 });
      await handle(post(report()));
      expect(pruned).toEqual(["2026-10-22"]);
    });

    it("keeps everything when switched off or given something that is not a number of days", async () => {
      for (const keepDays of [false, 0, -5, Number.NaN] as const) {
        const { pruned, handle } = pruning({ keepDays });
        expect((await handle(post(report()))).status).toBe(204);
        expect(pruned).toEqual([]);
      }
    });

    it("keeps everything when given more days than a date can go back", async () => {
      for (const keepDays of [Infinity, 1e9, Number.MAX_VALUE]) {
        const errors: unknown[] = [];
        const { pruned, handle } = pruning({ keepDays, onError: (error) => errors.push(error) });
        expect((await handle(post(report()))).status).toBe(204);
        expect(pruned).toEqual([]);
        expect(errors).toEqual([]);
      }
    });

    it("does not clean up for a report it did not store", async () => {
      const { pruned, handle } = pruning();
      await handle(post(report(), { "user-agent": "Googlebot/2.1" }));
      await handle(post({ nonsense: true }));
      expect(pruned).toEqual([]);
    });

    it("still stores the report when cleaning up fails, and tells onError", async () => {
      const inner = memoryStore();
      const store: Store = { ...inner, prune: () => Promise.reject(new Error("locked")) };
      const errors: unknown[] = [];
      const { handle, total } = setup({ store, onError: (error) => errors.push(error) });
      expect((await handle(post(report()))).status).toBe(204);
      expect((await handle(post(report()))).status).toBe(204);
      expect(await total()).toBe(4);
      expect(errors).toHaveLength(1);
    });
  });

  it("never throws, also not when onError does", async () => {
    const store: Store = { ...memoryStore(), add: () => Promise.reject(new Error("no")) };
    const { handle } = setup({
      store,
      onError: () => {
        throw new Error("the error handler fails too");
      },
    });
    expect((await handle(post(report()))).status).toBe(500);
  });
});
