# fieldvitals

Web vitals from real visitors, stored in the database your site already has.

No third party, no cookies, no visitor identifiers and no row per visitor: the only thing kept
is a set of counters per day, page, metric and device class.

> **Status: alpha.** Everything below is built and tested, and runs in the example app. It has
> not seen much real traffic yet, and the API may still change. Not on npm yet: see
> [Install](#install).

For Next.js 16 (App Router) and React 19. The storage and the endpoint do not depend on Next.

## What you get

- **A client component** that measures TTFB, FCP, LCP, CLS and INP per page view, including
  page views that come from a link inside the site, and sends one small report per page view
  to your own domain.
- **An endpoint** that adds those reports to counters in your database.
- **A dashboard** as a React server component, without client script: the 75th percentile per
  metric and per route, the share of good / needs improvement / poor, and the trend per day.
- **A function for alerts** that returns which metrics are over their threshold.

## Install

Until the package is on npm, install the tarball of a
[release](https://github.com/brense/fieldvitals/releases):

```sh
bun add https://github.com/brense/fieldvitals/releases/download/v0.1.0-alpha.1/brows-fieldvitals-0.1.0-alpha.1.tgz
# or: npm install <the same address>
```

The lockfile keeps a hash of that file, so every install gets the same code. Installing
straight from the git repository does not work: the built files are not in git.

## Use in a Next app

```ts
// lib/vitals.ts
import { createClient } from "@libsql/client";
import { libsqlStore } from "@brows/fieldvitals/store/libsql";

export const vitals = libsqlStore(createClient({ url: process.env.DATABASE_URL! }));
```

```tsx
// app/layout.tsx
import { FieldVitals } from "@brows/fieldvitals/next";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <FieldVitals />
      </body>
    </html>
  );
}
```

```ts
// app/api/vitals/route.ts
import { createHandler } from "@brows/fieldvitals/server";
import { vitals } from "@/lib/vitals";

export const POST = createHandler({ store: vitals, onError: console.error });
```

```tsx
// app/admin/vitals/page.tsx: put this behind your own sign-in
import { Suspense } from "react";
import { Dashboard } from "@brows/fieldvitals/dashboard";
import { vitals } from "@/lib/vitals";

export default function Page({ searchParams }: PageProps<"/admin/vitals">) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Dashboard store={vitals} searchParams={searchParams} />
    </Suspense>
  );
}
```

The table (`fieldvitals_buckets`) is created the first time it is needed. A complete app is in
[examples/next](examples/next).

### `<FieldVitals />`

| Prop         | Default       | Meaning                                                    |
| ------------ | ------------- | ---------------------------------------------------------- |
| `endpoint`   | `/api/vitals` | Where reports go. Same origin only                         |
| `sampleRate` | `1`           | Share of page loads that report, from 0 to 1. Decided once |

Render it once, in the root layout: it reads which page is shown from there. Both props are
read once per page load.

### `createHandler(options)`

Returns `(request: Request) => Promise<Response>`. It never throws.

| Option         | Default | Meaning                                                                  |
| -------------- | ------- | ------------------------------------------------------------------------ |
| `store`        |         | Where the counters go                                                    |
| `maxRoutes`    | `200`   | Distinct routes per day. What comes after is counted as `(other)`        |
| `maxPerMinute` | `600`   | Reports per minute per server process. More are answered with 429        |
| `keepDays`     | `400`   | Days of history to keep; older days are removed. `false` keeps it all    |
| `ignoreBots`   | `true`  | Leaves out crawlers, uptime checkers and headless browsers               |
| `onError`      |         | Called when the database fails, for example to report it to your tracker |

It accepts `POST` from the same origin only, reads at most 2 kB and stores nothing but
counters. Anyone can still post made-up numbers from a browser on your site, as with every
measurement that comes from visitors; the limits keep the damage small.

### `<Dashboard />`

| Prop           | Default      | Meaning                                                   |
| -------------- | ------------ | --------------------------------------------------------- |
| `store`        |              | The same store the handler writes to                      |
| `searchParams` | `{}`         | Of the page, as an object or a promise. Holds the filters |
| `days`         | `28`         | Period when the address does not say                      |
| `minSamples`   | `20`         | Fewer measurements than this are marked as "few"          |
| `title`        | `Web vitals` | Heading. `null` leaves it out                             |

The dashboard checks nobody's access: put the page behind your own sign-in. It takes its
colours and font from the page around it. To change the rating colours, set `--fv-good`,
`--fv-needs-improvement` and `--fv-poor`; `--fv-line` and `--fv-muted` are the lines and the
secondary text. `DashboardView` renders the same thing from data you fetched yourself with
`overview()`.

### Alerts

```ts
import { evaluate } from "@brows/fieldvitals/server";

const findings = await evaluate(vitals, { days: 7, minSamples: 20 });
// [{ route: null, metric: "LCP", p75: 4310, rating: "poor", threshold: 4000, count: 212, … }]
```

`evaluate()` returns the metrics whose 75th percentile is rated poor (or, with
`level: "needs-improvement"`, not good), for the whole site (`route: null`) and per route. It
sends nothing: call it from a scheduled job and pass the result to whatever already sends you
alerts.

## How it works

A measurement (say, LCP 1840 ms on `/orders/[id]`, mobile) is not stored as a row. It adds one
to a counter: the bucket that 1840 ms falls in, for that day, route, metric and device class.
Percentiles are computed from those counters afterwards.

- Buckets grow by about 10% per step, and the thresholds that decide between good, needs
  improvement and poor (2500 and 4000 ms for LCP, for example) are bucket edges.
- A percentile is therefore off by less than one bucket: about 10% at most, usually far less.
  The counts per rating, and the rating of the 75th percentile, are exact.
- A busy site uses the same number of rows as a quiet one.

Thresholds are those of the [web-vitals](https://github.com/GoogleChrome/web-vitals) library.
Days are UTC days.

## Privacy

Stored: counters per day, route pattern, metric, device class (mobile or desktop) and
navigation type (page load or link inside the site). Nothing else.

Not stored and not sent: cookies, visitor or session ids, IP addresses, the user agent,
addresses with parameter values, query strings, the referrer.

The component sends the route pattern (`/orders/[id]`), not the address that was visited
(`/orders/8731`). The pattern is made in the browser from what the router rendered, with
parameter values replaced by their names; the address itself is not used for it. When there
is no pattern to be had, it sends nothing for that page view. On the server, `parseReport()` only
accepts a route that looks like a path, without query string or fragment, and drops every
field it does not know.

Whether a site may measure this without asking consent is for the site owner to judge. This
package only makes sure there is nothing personal in what is kept.

## What the numbers leave out

- A page view is reported when the page is hidden or left. Browsers do not always get that
  far (a crash, a phone that kills the tab), so some page views are missing.
- CLS and INP have the value they had when the page was first hidden. What happens after the
  visitor comes back to the tab is not counted.
- Pages restored from the back/forward cache are not counted. Chrome's own field data (CrUX)
  does count them, so numbers will not match exactly.
- Page views from a link inside the site are only measured apart in browsers that report soft
  navigations (Chromium). In other browsers everything belongs to the page that was loaded
  first, and its CLS and INP cover the whole visit. There is no TTFB for these page views.
- Not every browser measures everything. CLS comes from Chromium browsers only; LCP and INP
  need Firefox 122 / 144 or Safari 26.2 at least. The number of measurements under each
  metric shows how many visits it is based on.
- An optional catch-all route shows as two routes: `/shop` and `/shop/[...filters]`.
- A parameter value that equals a fixed part of the path (`/orders/orders`) is matched at the
  last place it fits.
- A rewrite is counted under the page that is shown, not under the address: with
  `/share/:token` rewritten to `/shared`, the measurements are those of `/shared`.
- A route that is shown over another page (an intercepted route in a parallel slot) is counted
  under the page below it, or not at all when its parameters are not in that page's route.
- App Router only. In the Pages Router the component sends nothing.
- The limits on reports per minute and routes per day are per server process. On serverless
  hosting they are approximate.

## The core on its own

```ts
import { histograms, parseReport, summarize, toCounts, utcDay } from "@brows/fieldvitals";
import { memoryStore } from "@brows/fieldvitals/store/memory";

const store = memoryStore();
const parsed = parseReport({
  v: 1,
  route: "/orders/[id]",
  device: "mobile",
  nav: "hard",
  metrics: [{ name: "LCP", value: 1840 }],
});
if (parsed.ok) await store.add(toCounts(parsed.report, utcDay()));

const readings = await store.read({ from: "2026-11-01", to: "2026-11-30", by: ["route"] });
for (const [route, perMetric] of histograms(readings, (reading) => reading.route ?? "")) {
  console.log(route, summarize("LCP", perMetric.LCP));
  // { count: 1, p75: 1890, rating: "good", good: 1, needsImprovement: 0, poor: 0 }
}
```

`overview(store, { days: 28 })` from `@brows/fieldvitals/server` gives what the dashboard
shows, as data. A store is a small interface (`migrate`, `add`, `read`, `routes`, `prune`);
`test/store-contract.ts` holds the tests every store has to pass. `@libsql/client`, `next` and
`react` are optional peer dependencies: you need each only for the entry point that uses it.

## Development

```sh
bun install
bun run test        # Vitest
bun run typecheck
bun run lint
bun run format
bun run build       # to dist/
bun run example:pack   # builds, packs and installs the package into examples/next
```

The bucket edges are part of the storage format: stored counts point at them by index. A test
pins the full list. If it fails, the scale changed and existing data would be read wrongly.

A release is a tag plus the tarball from `bun pm pack` attached to the release on GitHub. Give
every tarball its own version: package managers cache a tarball by its address.

## Licence

MIT
