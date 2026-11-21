import type { Client, InValue } from "@libsql/client";
import { isMetric } from "../metrics.js";
import { checkCounts, checkQuery, type Reading, type Store } from "../store.js";

/** Only what is used, so anything that looks like a libSQL client will do */
export type LibsqlClient = Pick<Client, "execute" | "batch">;

export type LibsqlStoreOptions = {
  /** Default `fieldvitals_buckets` */
  table?: string;
};

/**
 * Keeps the counts in a libSQL database: a SQLite file, Turso, or a libSQL server. One small
 * table, which `migrate()` creates. It can live next to the tables of the site itself.
 */
export function libsqlStore(client: LibsqlClient, options: LibsqlStoreOptions = {}): Store {
  const table = options.table ?? "fieldvitals_buckets";
  // The name goes into the SQL as it is, so it must be a plain identifier
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new TypeError(`invalid table name: ${table}`);

  return {
    async migrate() {
      await client.execute(
        `CREATE TABLE IF NOT EXISTS ${table} (
          day TEXT NOT NULL,
          route TEXT NOT NULL,
          metric TEXT NOT NULL,
          device TEXT NOT NULL,
          nav TEXT NOT NULL,
          bucket INTEGER NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (day, route, metric, device, nav, bucket)
        )`,
      );
    },

    async add(counts) {
      checkCounts(counts);
      if (counts.length === 0) return;
      const sql = `INSERT INTO ${table} (day, route, metric, device, nav, bucket, count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (day, route, metric, device, nav, bucket)
        DO UPDATE SET count = count + excluded.count`;
      await client.batch(
        counts.map(({ day, route, metric, device, nav, bucket, count }) => ({
          sql,
          args: [day, route, metric, device, nav, bucket, count],
        })),
        "write",
      );
    },

    async read(query) {
      // Also makes sure `by` holds column names and nothing else, as they go into the SQL
      checkQuery(query);
      const by = [...new Set(query.by)];
      const columns = [...by, "metric", "bucket"].join(", ");
      const where = ["day >= ?", "day <= ?"];
      const args: InValue[] = [query.from, query.to];
      for (const column of ["route", "device", "nav"] as const) {
        const value = query[column];
        if (value === undefined) continue;
        where.push(`${column} = ?`);
        args.push(value);
      }
      const result = await client.execute({
        sql: `SELECT ${columns}, SUM(count) AS count FROM ${table}
          WHERE ${where.join(" AND ")} GROUP BY ${columns}`,
        args,
      });
      const readings: Reading[] = [];
      for (const row of result.rows) {
        const metric = row.metric;
        // Written by a newer version that knows more metrics: not ours to interpret
        if (!isMetric(metric)) continue;
        const kept = Object.fromEntries(by.map((dimension) => [dimension, String(row[dimension])]));
        readings.push({ ...kept, metric, bucket: Number(row.bucket), count: Number(row.count) });
      }
      return readings;
    },

    async routes({ from, to }) {
      checkQuery({ from, to });
      const result = await client.execute({
        sql: `SELECT DISTINCT route FROM ${table} WHERE day >= ? AND day <= ? ORDER BY route`,
        args: [from, to],
      });
      return result.rows.map((row) => String(row.route));
    },

    async prune(day) {
      checkQuery({ from: day, to: day });
      const result = await client.execute({
        sql: `DELETE FROM ${table} WHERE day < ?`,
        args: [day],
      });
      return result.rowsAffected;
    },
  };
}
