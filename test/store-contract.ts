import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BucketCount } from "../src/protocol.js";
import type { Reading, Store } from "../src/store.js";

export type Opened = { store: Store; close: () => Promise<void> | void };

function count(overrides: Partial<BucketCount> = {}): BucketCount {
  return {
    day: "2026-11-21",
    route: "/",
    device: "mobile",
    nav: "hard",
    metric: "LCP",
    bucket: 10,
    count: 1,
    ...overrides,
  };
}

/** `read` promises no order */
function sorted(readings: Reading[]) {
  return readings.map((reading) => JSON.stringify(reading, Object.keys(reading).sort())).sort();
}

function expectSame(actual: Reading[], expected: Reading[]) {
  expect(sorted(actual)).toEqual(sorted(expected));
}

const november = { from: "2026-11-01", to: "2026-11-30" };

/** What every store has to do, whatever it keeps the counts in */
export function describeStore(name: string, open: () => Promise<Opened>) {
  describe(name, () => {
    let store: Store;
    let close: Opened["close"];

    beforeEach(async () => {
      ({ store, close } = await open());
      await store.migrate();
    });
    afterEach(() => close());

    it("starts empty", async () => {
      expect(await store.read(november)).toEqual([]);
      expect(await store.routes(november)).toEqual([]);
      expect(await store.prune("2026-11-21")).toBe(0);
    });

    it("can be migrated again without losing anything", async () => {
      await store.add([count()]);
      await store.migrate();
      expectSame(await store.read(november), [{ metric: "LCP", bucket: 10, count: 1 }]);
    });

    it("adds counts for the same bucket together, also within one call", async () => {
      await store.add([count(), count({ count: 3 })]);
      await store.add([count({ count: 2 })]);
      expectSame(await store.read(november), [{ metric: "LCP", bucket: 10, count: 6 }]);
    });

    it("accepts an empty list", async () => {
      await store.add([]);
      expect(await store.read(november)).toEqual([]);
    });

    it("adds up over every dimension that is not asked for", async () => {
      await store.add([
        count(),
        count({ day: "2026-11-22" }),
        count({ route: "/pricing" }),
        count({ device: "desktop" }),
        count({ nav: "soft" }),
        count({ metric: "CLS", bucket: 0 }),
        count({ bucket: 11 }),
      ]);
      expectSame(await store.read(november), [
        { metric: "LCP", bucket: 10, count: 5 },
        { metric: "LCP", bucket: 11, count: 1 },
        { metric: "CLS", bucket: 0, count: 1 },
      ]);
    });

    it("keeps the dimensions in `by` apart", async () => {
      await store.add([
        count({ count: 2 }),
        count({ day: "2026-11-22", count: 3 }),
        count({ route: "/pricing", count: 4 }),
        count({ route: "/pricing", device: "desktop", count: 5 }),
      ]);
      expectSame(await store.read({ ...november, by: ["route"] }), [
        { route: "/", metric: "LCP", bucket: 10, count: 5 },
        { route: "/pricing", metric: "LCP", bucket: 10, count: 9 },
      ]);
      expectSame(await store.read({ ...november, by: ["day", "device"] }), [
        { day: "2026-11-21", device: "mobile", metric: "LCP", bucket: 10, count: 6 },
        { day: "2026-11-21", device: "desktop", metric: "LCP", bucket: 10, count: 5 },
        { day: "2026-11-22", device: "mobile", metric: "LCP", bucket: 10, count: 3 },
      ]);
      expectSame(await store.read({ ...november, by: ["route", "route"] }), [
        { route: "/", metric: "LCP", bucket: 10, count: 5 },
        { route: "/pricing", metric: "LCP", bucket: 10, count: 9 },
      ]);
      expectSame(await store.read({ ...november, by: ["day", "route", "device", "nav"] }), [
        { ...count(), count: 2 },
        { ...count({ day: "2026-11-22" }), count: 3 },
        { ...count({ route: "/pricing" }), count: 4 },
        { ...count({ route: "/pricing", device: "desktop" }), count: 5 },
      ]);
    });

    it("reads a period including its first and last day", async () => {
      await store.add([
        count({ day: "2026-11-19" }),
        count({ day: "2026-11-20", count: 2 }),
        count({ day: "2026-11-22", count: 4 }),
        count({ day: "2026-11-23", count: 8 }),
      ]);
      expectSame(await store.read({ from: "2026-11-20", to: "2026-11-22" }), [
        { metric: "LCP", bucket: 10, count: 6 },
      ]);
      expectSame(await store.read({ from: "2026-11-23", to: "2026-11-23" }), [
        { metric: "LCP", bucket: 10, count: 8 },
      ]);
      expect(await store.read({ from: "2026-11-24", to: "2026-12-31" })).toEqual([]);
    });

    it("filters on route, device and nav", async () => {
      await store.add([
        count(),
        count({ route: "/pricing", count: 2 }),
        count({ device: "desktop", count: 4 }),
        count({ nav: "soft", count: 8 }),
      ]);
      expectSame(await store.read({ ...november, route: "/pricing" }), [
        { metric: "LCP", bucket: 10, count: 2 },
      ]);
      expectSame(await store.read({ ...november, device: "desktop" }), [
        { metric: "LCP", bucket: 10, count: 4 },
      ]);
      expectSame(await store.read({ ...november, nav: "soft" }), [
        { metric: "LCP", bucket: 10, count: 8 },
      ]);
      expectSame(await store.read({ ...november, route: "/", device: "mobile", nav: "hard" }), [
        { metric: "LCP", bucket: 10, count: 1 },
      ]);
      expect(await store.read({ ...november, route: "/nowhere" })).toEqual([]);
    });

    it("lists the routes of a period, sorted", async () => {
      await store.add([
        count({ route: "/pricing" }),
        count({ route: "/" }),
        count({ route: "/orders/[id]/edit", metric: "INP" }),
        count({ route: "/old", day: "2026-10-31" }),
      ]);
      expect(await store.routes(november)).toEqual(["/", "/orders/[id]/edit", "/pricing"]);
      expect(await store.routes({ from: "2026-10-01", to: "2026-10-31" })).toEqual(["/old"]);
    });

    it("keeps a route exactly as given", async () => {
      const route = "/it's;--/[id]/%27";
      await store.add([count({ route })]);
      expect(await store.routes(november)).toEqual([route]);
      expectSame(await store.read({ ...november, route, by: ["route"] }), [
        { route, metric: "LCP", bucket: 10, count: 1 },
      ]);
    });

    it("prunes everything before a day and keeps that day", async () => {
      await store.add([
        count({ day: "2026-11-19" }),
        count({ day: "2026-11-19", metric: "CLS", bucket: 0 }),
        count({ day: "2026-11-20" }),
        count({ day: "2026-11-21", count: 5 }),
      ]);
      expect(await store.prune("2026-11-21")).toBe(3);
      expectSame(await store.read({ from: "2000-01-01", to: "2999-12-31", by: ["day"] }), [
        { day: "2026-11-21", metric: "LCP", bucket: 10, count: 5 },
      ]);
      expect(await store.prune("2026-11-21")).toBe(0);
    });

    it("refuses counts that are not what they should be, and stores none of them", async () => {
      const wrong: Partial<Record<keyof BucketCount, unknown>>[] = [
        { day: "21-11-2026" },
        { day: "2026-11-21T10:00:00Z" },
        { route: "" },
        { device: "tablet" },
        { nav: "reload" },
        { metric: "FID" },
        { bucket: -1 },
        { bucket: 9999 },
        { bucket: 1.5 },
        { count: 0 },
        { count: 0.5 },
        { count: -3 },
      ];
      for (const override of wrong) {
        const counts = [count(), count(override as Partial<BucketCount>)];
        await expect(store.add(counts)).rejects.toThrow(TypeError);
      }
      expect(await store.read(november)).toEqual([]);
    });

    it("refuses a query that is not what it should be", async () => {
      await store.add([count()]);
      const smuggled = "route FROM x; DROP TABLE fieldvitals_buckets; --" as never;
      await expect(store.read({ ...november, by: [smuggled] })).rejects.toThrow(TypeError);
      await expect(store.read({ from: "yesterday", to: "2026-11-30" })).rejects.toThrow(TypeError);
      await expect(store.read({ from: "2026-11-01", to: "" })).rejects.toThrow(TypeError);
      await expect(store.routes({ from: "2026-11-01", to: "now" })).rejects.toThrow(TypeError);
      await expect(store.prune("everything")).rejects.toThrow(TypeError);
      expectSame(await store.read(november), [{ metric: "LCP", bucket: 10, count: 1 }]);
    });
  });
}
