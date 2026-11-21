# fieldvitals: design

Web vitals from real visitors, stored in the database the site already has.
No third party, no cookies, no visitor identifiers, no row per visitor.

Status: steps 1 and 2 are built (core and stores). The rest is the plan.

## What it does

1. **Collect.** A small client component measures TTFB, FCP, LCP, CLS and INP and sends them
   to an endpoint on the site's own domain when the visitor leaves the page.
2. **Store.** The endpoint adds each measurement to a histogram: a counter per day, route,
   metric and device class. Percentiles are computed from those counters.
3. **Show.** A dashboard component: 75th percentile per metric and per page, the share of
   good / needs improvement / poor, and a 28-day trend.
4. **Warn.** A function that compares recent values with thresholds and returns what is over,
   so the host app can send that to whatever it uses for alerts.

## Package layout

One package, several entry points, so a site only loads what it uses.

| Entry point                       | Runs in | Status  | Contents                                                         |
| --------------------------------- | ------- | ------- | ---------------------------------------------------------------- |
| `@brows/fieldvitals`              | both    | built   | types, protocol, bucket and percentile maths (no dependencies)   |
| `@brows/fieldvitals/store/libsql` | server  | built   | storage in libSQL / Turso / a SQLite file                        |
| `@brows/fieldvitals/store/memory` | server  | built   | storage in memory, for tests and examples                        |
| `@brows/fieldvitals/next`         | browser | planned | `<FieldVitals endpoint="/api/vitals" />`, uses `next/web-vitals` |
| `@brows/fieldvitals/server`       | server  | planned | `createHandler()`, `summary()`, `evaluate()`                     |
| `@brows/fieldvitals/dashboard`    | server  | planned | `<Dashboard />`, a React server component without client script  |

The handler is a plain `(request: Request) => Promise<Response>`, so it is not tied to Next.
A framework-neutral collector (`@brows/fieldvitals/browser`, on Google's `web-vitals`) can follow later
without changing the protocol or the storage.

### Use in a Next app (planned)

```tsx
// app/layout.tsx
import { FieldVitals } from "@brows/fieldvitals/next";
// <FieldVitals endpoint="/api/vitals" /> inside <body>

// app/api/vitals/route.ts
import { createHandler } from "@brows/fieldvitals/server";
import { libsqlStore } from "@brows/fieldvitals/store/libsql";
export const POST = createHandler({ store: libsqlStore(client) });

// app/admin/vitals/page.tsx (behind the site's own sign-in)
import { Dashboard } from "@brows/fieldvitals/dashboard";
// <Dashboard store={store} days={28} />
```

## Protocol (version 1)

One `POST` per page view, sent with `navigator.sendBeacon` when the page is hidden:

```json
{
  "v": 1,
  "route": "/orders/[id]/edit",
  "device": "mobile",
  "nav": "hard",
  "metrics": [
    { "name": "LCP", "value": 1840 },
    { "name": "CLS", "value": 0.02 }
  ]
}
```

- `route` is the route pattern, not the address. The client replaces parameter values with
  their names (from `useParams`), so ids and tokens in the path never leave the browser. Query
  string and fragment are never read.
- `device` is `mobile` or `desktop`, decided in the browser. The user agent is not stored.
- `nav` is `hard` (page load) or `soft` (client-side navigation).

`parseReport()` checks all of this and keeps only the fields above: a route must look like a
path (at most 200 characters, no query string or fragment), each metric may appear once, values
must be finite and not negative.

The endpoint (step 3) accepts same-origin requests only, limits the body size, limits the number
of distinct routes per day (the rest is counted as `(other)`) and limits requests per minute per
server process. It never stores an IP address.

## Storage

```sql
CREATE TABLE IF NOT EXISTS fieldvitals_buckets (
  day    TEXT    NOT NULL,  -- 2026-11-21 (UTC)
  route  TEXT    NOT NULL,
  metric TEXT    NOT NULL,  -- TTFB | FCP | LCP | CLS | INP
  device TEXT    NOT NULL,  -- mobile | desktop
  nav    TEXT    NOT NULL,  -- hard | soft
  bucket INTEGER NOT NULL,  -- index into fixed bucket edges for that metric
  count  INTEGER NOT NULL,
  PRIMARY KEY (day, route, metric, device, nav, bucket)
);
```

A plain table: no `WITHOUT ROWID` and nothing else that only some SQLite-compatible engines
have. Counts are added with one upsert per bucket (`ON CONFLICT … DO UPDATE SET count = count +
excluded.count`), all in one write batch.

### Buckets

Bucket edges are fixed per metric (`src/buckets.ts`). They grow by about 10% per step and the
official thresholds (for example 2500 and 4000 ms for LCP) are exact edges. Bucket `i` holds
the values above edge `i - 1` up to and including edge `i`; the first bucket starts at 0 and
one open bucket holds everything above the last edge. Between 57 and 77 edges per metric.

The edges are part of the storage format: stored counts point at them by index. They are
generated with whole-number arithmetic only, so every JavaScript engine gets the same list,
and a test pins the full list. A different scale needs a new table or a migration.

What that gives:

- A percentile is always reported inside the bucket that the real percentile is in, so it is
  off by less than one bucket: about 10% at most, usually far less.
- Good / needs improvement / poor counts are exact, because no bucket crosses a threshold.
- The rating of the 75th percentile is exact too: it comes from the bucket, not from the
  estimate.
- A busy site and a quiet site use the same number of rows: at most routes x metrics x 4 x
  buckets per day. Old days are removed by `prune()`.

### Store interface

```ts
interface Store {
  migrate(): Promise<void>; // safe to call at every start
  add(counts: readonly BucketCount[]): Promise<void>;
  read(query: Query): Promise<Reading[]>; // from, to, optional route/device/nav, group `by`
  routes(period: Period): Promise<string[]>;
  prune(day: string): Promise<number>; // removes everything before that day
}
```

A store only adds numbers up and hands them back. Percentiles and ratings are computed by the
core from what `read()` returns, so other databases can be added without touching the rest.
One set of tests (`test/store-contract.ts`) runs against every store. The table has its own
prefix and its own migration, separate from the host app's schema.

## Alerts

`evaluate(store, { window: "24h", minSamples: 20 })` returns the metrics whose 75th percentile
is rated poor, per route and site-wide. It sends nothing itself. The host decides when to call
it and what to do with the result, for example report it to the error tracker that already
sends mail.

Low traffic gives noisy numbers, hence `minSamples`.

## Privacy

Stored: counters per day, route pattern, metric, device class. Nothing else.
Not stored and not sent: cookies, visitor or session ids, IP addresses, user agent, addresses
with parameter values, query strings, referrer.

Whether a site may measure this without asking consent is for the site owner to judge; the
package only makes sure there is nothing personal in what is kept.

## Tooling

bun, TypeScript, ESM only, Vitest, Prettier, ESLint. The core has no dependencies. Optional
peer dependencies: `@libsql/client` (only for that store), later `react` 19 and `next` 16 (only
for the entry points that use them).

## Steps

1. Core: buckets, percentiles, protocol validation, with tests. **Done.**
2. libSQL store and migration, with tests against a file database. **Done.**
3. Handler and the Next client component.
4. Dashboard component.
5. `evaluate()` for alerts.
6. Example app, then a first real site as user (git dependency), checked on its staging.
7. Publish to npm: only when decided. Until then `package.json` has `"private": true`.

## Decided

- Licence: MIT.
- Public mirror on GitHub: `brense/fieldvitals`.
- npm name: `@brows/fieldvitals`.

## To check while building

- That `useParams` gives enough to rebuild the route pattern in all cases (catch-all and
  optional segments, parallel routes).
- Which metrics Next reports for soft navigations, and whether INP and CLS arrive before the
  page is hidden on mobile browsers.
