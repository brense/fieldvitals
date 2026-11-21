import { Dashboard } from "@brows/fieldvitals/dashboard";
import { Suspense } from "react";
import { store } from "../../lib/store";

/** A real site checks here who is asking: the dashboard itself does not */
export default function Page({ searchParams }: PageProps<"/vitals">) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Dashboard store={store} searchParams={searchParams} />
    </Suspense>
  );
}
