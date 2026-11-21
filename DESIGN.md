# fieldvitals: design

Web vitals from real visitors, stored in the database the site already has.
No third party, no cookies, no visitor identifiers, no row per visitor.

Status: steps 1 to 6 are built. How to use it is in the [README](README.md); this file says
why it is built the way it is.

## What it does

1. **Collect.** A small client component measures TTFB, FCP, LCP, CLS and INP and sends them
   to an endpoint on the site's own domain when the visitor leaves the page.
2. **Store.** The endpoint adds each measurement to a histogram: a counter per day, route,
   metric and device class. Percentiles are computed from those counters.
3. **Show.** A dashboard component: 75th percentile per metric and per page, the share of
   good / needs improvement / poor, and the trend per day.
4. **Warn.** A function that compares recent values with thresholds and returns what is over,
   so the host app can send that to whatever it uses for alerts.

## Package layout

One package, several entry points, so a site only loads what it uses.

| Entry point                       | Runs in | Contents                                                         |
| --------------------------------- | ------- | ---------------------------------------------------------------- |
| `@brows/fieldvitals`              | both    | types, protocol, bucket and percentile maths (no dependencies)   |
| `@brows/fieldvitals/store/libsql` | server  | storage in libSQL / Turso / a SQLite file                        |
| `@brows/fieldvitals/store/memory` | server  | storage in memory, for tests and examples                        |
| `@brows/fieldvitals/next`         | browser | `<FieldVitals endpoint="/api/vitals" />`, uses `next/web-vitals` |
| `@brows/fieldvitals/server`       | server  | `createHandler()`, `overview()`, `evaluate()`                    |
| `@brows/fieldvitals/dashboard`    | server  | `<Dashboard />`, a React server component without client script  |

The handler is a plain `(request: Request) => Promise<Response>`, so it is not tied to Next.
A framework-neutral collector (`@brows/fieldvitals/browser`, on Google's `web-vitals`) can follow later
without changing the protocol or the storage.

## Collecting

`next/web-vitals` reports each metric with the page view it belongs to. A page load is one
page view; in browsers that report soft navigations, every link followed inside the site is
another. The collector (`src/collector.ts`, no dependency on Next or the DOM, so it is tested
as plain code) keeps the values per page view and sends each page view once:

- when the page is hidden or left, which is the last moment a browser reliably gives. The
  metrics a browser hands over at that moment arrive one after the other; they go out together
  in one report;
- for a page view that was left by a link inside the site: three seconds after the next page
  view starts, since nothing more will come for it.

A metric is sent once per page view, with the value it had then. What a browser reports
later for the same page view is dropped: adding it would count the page view twice.

The route pattern is made in the browser from the router's own tree
(`useSelectedLayoutSegments()` in the root layout) and `useParams()` (`src/route.ts`). The
tree holds folder names and parameter values. Route groups and the markers of intercepted
routes are dropped, and every parameter value is replaced by its name, catch-all values by
`[...name]`. Values are matched from the end, because a fixed part can have the same text as
a value. When a value cannot be found back, there is no pattern and nothing is sent for that
page view. A page that is not found reports as `/_not-found`.

The address in the browser is not used for the pattern. An earlier version did use it, and
that leaked with a rewrite: `/share/<token>` shown by a fixed page has no parameters, so the
address looked like a pattern and was sent as it was. The tree only holds what was rendered,
so there is nothing in it that the router does not know to be a parameter. The address still
serves one purpose, inside the browser: finding which page view a measurement belongs to.

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

- `route` is the route pattern, not the address. The client makes it from the route that was
  rendered and replaces parameter values with their names (from `useParams`), so ids and
  tokens in the path never leave the browser. Query
  string and fragment are never read.
- `device` is `mobile` or `desktop`, decided in the browser. The user agent is not stored.
- `nav` is `hard` (page load) or `soft` (client-side navigation).

`parseReport()` checks all of this and keeps only the fields above: a route must look like a
path (at most 200 characters, no query string or fragment), each metric may appear once, values
must be finite and not negative.

## Endpoint

`createHandler()` gives a plain `(request: Request) => Promise<Response>`. In order:

1. Only `POST`.
2. Same origin only: `Sec-Fetch-Site` must say `same-origin` when the browser sends it,
   otherwise the host of `Origin` must be the host the request came in on. This keeps other
   sites from making their visitors' browsers post here. It does not stop someone posting by
   hand, and nothing can: the numbers come from browsers.
3. A fixed number of reports per minute per server process.
4. At most 2 kB of body, cut off while reading.
5. `parseReport()`.
6. Crawlers, uptime checkers and headless browsers get the same answer as everyone, but
   nothing is stored. The user agent is looked at for this and not kept.
7. A fixed number of distinct routes per day; what comes after is counted as `(other)`. This
   bounds the table when someone posts made-up routes.

No IP address is read anywhere, so the limits are per process and not per visitor. That is a
choice: a per-visitor limit needs something that identifies the visitor.

The table is created on the first report or the first read (`src/ready.ts`), so there is no
setup step. Once a day the handler removes days older than `keepDays`.

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

`evaluate(store, { days: 7, minSamples: 20 })` returns the metrics whose 75th percentile
is rated poor, per route and site-wide. The period is in whole UTC days, like everything else:
the counters are per day, so a window of hours does not exist. It sends nothing itself. The host decides when to call
it and what to do with the result, for example report it to the error tracker that already
sends mail.

Low traffic gives noisy numbers, hence `minSamples`.

## Dashboard

A server component that reads the store and returns HTML and one `<style>` element: no client
script, so it costs the page nothing and works in any React 19 server setup. Filters are links
that change the query string. It inherits font and colours from the page and only brings its
own colours for the three ratings, which also differ in shape and are named in text.

A number based on fewer than `minSamples` measurements is marked: with little traffic a 75th
percentile is close to a single visit.

The dashboard does not check who is looking. That belongs to the page it is put on.

## Privacy

Stored: counters per day, route pattern, metric, device class. Nothing else.
Not stored and not sent: cookies, visitor or session ids, IP addresses, user agent, addresses
with parameter values, query strings, referrer.

Whether a site may measure this without asking consent is for the site owner to judge; the
package only makes sure there is nothing personal in what is kept.

## Tooling

bun, TypeScript, ESM only, Vitest, Prettier, ESLint. The core has no dependencies. Optional
peer dependencies: `@libsql/client` (only for that store), `react` 19 and `next` 16 (only for
the entry points that use them).

## Steps

1. Core: buckets, percentiles, protocol validation, with tests. **Done.**
2. libSQL store and migration, with tests against a file database. **Done.**
3. Handler and the Next client component. **Done.**
4. Dashboard component. **Done.**
5. `evaluate()` for alerts. **Done.**
6. Example app (`examples/next`), then a first real site as user. **Done**; installed from the
   tarball of a release, because a git dependency has no built files.
7. Publish to npm: only when decided. Until then `package.json` has `"private": true`.

## Decided

- Licence: MIT.
- Public mirror on GitHub: `brense/fieldvitals`.
- npm name: `@brows/fieldvitals`.

## Checked while building

In the example app, Next 16.4 and Chrome 151:

- The route tree and `useParams` give enough to make the pattern for static, dynamic,
  catch-all and optional catch-all segments, nested parameters and route groups. A catch-all
  is one segment in the tree (`a/b`). An optional catch-all without a value has no parameter,
  so `/shop` and `/shop/[...filters]` show as two routes.
- A rewrite to a fixed page (`/share/:token` to `/shared`) and one to a page with a parameter
  (`/u/:name` to `/blog/[slug]`) are both counted under the page that is shown, on a page load
  as well as on a link inside the site.
- A page load reports TTFB, FCP, LCP, CLS and INP. A soft navigation reports FCP, LCP, CLS and
  INP, each with its own navigation id and address; there is no TTFB for it.
- LCP, CLS and INP of a page view arrive when the page is hidden or when the next page view
  starts, not before. That is why a page view is sent at those two moments.
- A report sent with `sendBeacon` while the page is being left arrives, for a tab that is
  closed as well as for a link to another site.

## Later, maybe

- A framework-neutral collector (`@brows/fieldvitals/browser`) on Google's `web-vitals`.
- Stores for other databases (Postgres first).
- Counting pages restored from the back/forward cache, as CrUX does.
