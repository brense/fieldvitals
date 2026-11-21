# fieldvitals with Next.js

A small App Router site with every kind of route (static, dynamic, catch-all, optional
catch-all, route group, rewrite, not found) that measures its own visits and shows them at
`/vitals`.

The three places where the library is used:

- `app/layout.tsx`: `<FieldVitals />` measures in the browser;
- `app/api/vitals/route.ts`: `createHandler` takes the reports;
- `app/vitals/page.tsx`: `<Dashboard />` shows them.

`lib/store.ts` keeps the counts in a SQLite file, `vitals.db`.

## Run it

The app uses the library as it is packed for publishing, so build that first. From the
repository root:

```sh
bun install
bun run example:pack      # builds the library into examples/next/fieldvitals.tgz
cd examples/next
bun install
bun run build && bun run start
```

Click around, switch to another tab so the browser sends what it measured, and open
<http://localhost:3000/vitals>.
