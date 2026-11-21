import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { libsqlStore } from "../src/store/libsql.js";
import { memoryStore } from "../src/store/memory.js";
import { describeStore } from "./store-contract.js";

function openDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fieldvitals-"));
  const client = createClient({ url: `file:${join(directory, "test.db")}` });
  return {
    client,
    close() {
      client.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

describeStore("memoryStore", async () => ({ store: memoryStore(), close() {} }));

describeStore("libsqlStore", async () => {
  const { client, close } = openDatabase();
  return { store: libsqlStore(client), close };
});

describe("libsqlStore", () => {
  it("keeps its counts in the database, not in the store object", async () => {
    const { client, close } = openDatabase();
    try {
      const first = libsqlStore(client);
      await first.migrate();
      await first.add([
        {
          day: "2026-11-21",
          route: "/",
          device: "mobile",
          nav: "hard",
          metric: "LCP",
          bucket: 3,
          count: 2,
        },
      ]);
      const second = libsqlStore(client);
      expect(await second.read({ from: "2026-11-21", to: "2026-11-21" })).toEqual([
        { metric: "LCP", bucket: 3, count: 2 },
      ]);
    } finally {
      close();
    }
  });

  it("can use another table name, apart from the default one", async () => {
    const { client, close } = openDatabase();
    try {
      const standard = libsqlStore(client);
      const other = libsqlStore(client, { table: "vitals_other" });
      await standard.migrate();
      await other.migrate();
      await other.add([
        {
          day: "2026-11-21",
          route: "/",
          device: "desktop",
          nav: "soft",
          metric: "INP",
          bucket: 5,
          count: 1,
        },
      ]);
      const period = { from: "2026-11-21", to: "2026-11-21" };
      expect(await standard.read(period)).toEqual([]);
      expect(await other.read(period)).toEqual([{ metric: "INP", bucket: 5, count: 1 }]);
    } finally {
      close();
    }
  });

  it("refuses a table name that is not a plain identifier", () => {
    const { client, close } = openDatabase();
    try {
      for (const table of ["", "1vitals", "vitals; DROP TABLE x", "a-b", 'a"b', "a b"]) {
        expect(() => libsqlStore(client, { table })).toThrow(TypeError);
      }
    } finally {
      close();
    }
  });

  it("passes over a metric it does not know", async () => {
    const { client, close } = openDatabase();
    try {
      const store = libsqlStore(client);
      await store.migrate();
      await client.execute(
        "INSERT INTO fieldvitals_buckets VALUES ('2026-11-21', '/', 'NEW', 'mobile', 'hard', 1, 4)",
      );
      await client.execute(
        "INSERT INTO fieldvitals_buckets VALUES ('2026-11-21', '/', 'LCP', 'mobile', 'hard', 1, 4)",
      );
      expect(await store.read({ from: "2026-11-21", to: "2026-11-21" })).toEqual([
        { metric: "LCP", bucket: 1, count: 4 },
      ]);
    } finally {
      close();
    }
  });
});
