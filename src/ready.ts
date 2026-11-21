import type { Store } from "./store.js";

const migrated = new WeakMap<Store, Promise<void>>();

/**
 * Makes sure a store has what it needs, once per store per server process, so a site does not
 * have to call `migrate()` itself. A failed attempt is tried again at the next call.
 */
export function ready(store: Store): Promise<void> {
  let attempt = migrated.get(store);
  if (!attempt) {
    attempt = store.migrate();
    migrated.set(store, attempt);
    attempt.catch(() => migrated.delete(store));
  }
  return attempt;
}
