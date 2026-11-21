# fieldvitals

Web vitals from real visitors, stored in the database your site already has.

No third party, no cookies, no visitor identifiers and no row per visitor: the only thing kept
is a set of counters per day, page, metric and device class.

> **Status: early.** The core (bucket and percentile maths, the report format) and the stores
> are built and tested. The parts that collect measurements in the browser, receive them on
> the server and show them on a dashboard are not there yet. See [DESIGN.md](DESIGN.md) for
> the plan. Not on npm yet.

## How it works

A measurement (say, LCP 1840 ms on `/orders/[id]`, mobile) is not stored as a row. It adds one
to a counter: the bucket that 1840 ms falls in, for that day, route, metric and device class.
Percentiles are computed from those counters afterwards.

- Buckets grow by about 10% per step, and the thresholds that decide between good, needs
  improvement and poor (2500 and 4000 ms for LCP, for example) are bucket edges.
- A percentile is therefore off by less than one bucket: about 10% at most, usually far less.
  The counts per rating, and the rating of the 75th percentile, are exact.
- A busy site uses the same number of rows as a quiet one.

Metrics: TTFB, FCP, LCP, CLS, INP, with the thresholds of the
[web-vitals](https://github.com/GoogleChrome/web-vitals) library.

## What you can use today

```ts
import { createClient } from "@libsql/client";
import { histograms, parseReport, summarize, toCounts, utcDay } from "@brows/fieldvitals";
import { libsqlStore } from "@brows/fieldvitals/store/libsql";

const store = libsqlStore(createClient({ url: "file:site.db" }));
await store.migrate(); // creates one table, safe to call at every start

// Store what a browser sent
const parsed = parseReport({
  v: 1,
  route: "/orders/[id]",
  device: "mobile",
  nav: "hard",
  metrics: [
    { name: "LCP", value: 1840 },
    { name: "CLS", value: 0.02 },
  ],
});
if (parsed.ok) await store.add(toCounts(parsed.report, utcDay()));

// Read it back: the 75th percentile per route
const readings = await store.read({ from: "2026-11-01", to: "2026-11-30", by: ["route"] });
for (const [route, perMetric] of histograms(readings, (reading) => reading.route ?? "")) {
  console.log(route, summarize("LCP", perMetric.LCP));
  // { count: 1, p75: 1890, rating: "good", good: 1, needsImprovement: 0, poor: 0 }
}

// Keep 90 days
await store.prune("2026-08-23");
```

`@brows/fieldvitals/store/memory` has the same interface and keeps everything in memory, for
tests and examples.

`@libsql/client` is an optional peer dependency: you only need it for the libSQL store, which
works with a SQLite file, Turso or a libSQL server.

## Privacy

Stored: counters per day, route pattern, metric, device class (mobile or desktop) and
navigation type (page load or client-side navigation). Nothing else.

`parseReport()` only accepts a route that looks like a path, without query string or fragment,
and drops every field it does not know. The route is meant to be the pattern
(`/orders/[id]`), not the address that was visited (`/orders/8731`): the collector will
replace parameter values with their names before anything leaves the browser.

Whether a site may measure this without asking consent is for the site owner to judge. This
package only makes sure there is nothing personal in what is kept.

## Development

```sh
bun install
bun run test        # Vitest
bun run typecheck
bun run lint
bun run format
bun run build       # to dist/
```

The bucket edges are part of the storage format: stored counts point at them by index. A test
pins the full list. If it fails, the scale changed and existing data would be read wrongly.

## Licence

MIT
