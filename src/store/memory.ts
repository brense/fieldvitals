import type { BucketCount } from "../protocol.js";
import { checkCounts, checkQuery, type Reading, type Store } from "../store.js";

/**
 * Keeps the counts in memory: gone at a restart and not shared between server processes.
 * For tests, examples and trying things out.
 */
export function memoryStore(): Store {
  const rows = new Map<string, BucketCount>();
  return {
    async migrate() {},

    async add(counts) {
      checkCounts(counts);
      for (const { day, route, device, nav, metric, bucket, count } of counts) {
        const key = JSON.stringify([day, route, device, nav, metric, bucket]);
        const row = rows.get(key);
        if (row) row.count += count;
        else rows.set(key, { day, route, device, nav, metric, bucket, count });
      }
    },

    async read(query) {
      checkQuery(query);
      const by = [...new Set(query.by)];
      const readings = new Map<string, Reading>();
      for (const row of rows.values()) {
        if (row.day < query.from || row.day > query.to) continue;
        if (query.route !== undefined && row.route !== query.route) continue;
        if (query.device !== undefined && row.device !== query.device) continue;
        if (query.nav !== undefined && row.nav !== query.nav) continue;
        const kept = Object.fromEntries(by.map((dimension) => [dimension, row[dimension]]));
        const key = JSON.stringify([kept, row.metric, row.bucket]);
        const reading = readings.get(key);
        if (reading) reading.count += row.count;
        else
          readings.set(key, { ...kept, metric: row.metric, bucket: row.bucket, count: row.count });
      }
      return [...readings.values()];
    },

    async routes({ from, to }) {
      checkQuery({ from, to });
      const found = new Set<string>();
      for (const row of rows.values()) if (row.day >= from && row.day <= to) found.add(row.route);
      return [...found].sort();
    },

    async prune(day) {
      checkQuery({ from: day, to: day });
      let removed = 0;
      for (const [key, row] of rows) {
        if (row.day < day && rows.delete(key)) removed++;
      }
      return removed;
    },
  };
}
