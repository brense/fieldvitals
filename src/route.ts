import { MAX_ROUTE_LENGTH } from "./protocol.js";

/** What a router knows about the current address: parameter names with their values */
export type RouteParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Addresses and parameters may or may not be percent-encoded, depending on where they come from */
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Where `parts` sits in `segments`, searching down from `before`; -1 when it is not there */
function findLast(segments: readonly string[], parts: readonly string[], before: number): number {
  for (let start = before - parts.length; start >= 0; start--) {
    if (parts.every((part, offset) => segments[start + offset] === part)) return start;
  }
  return -1;
}

/**
 * Turns an address into its route pattern by putting parameter names back where the values
 * are: `/orders/8731/edit` with `{ id: "8731" }` gives `/orders/[id]/edit`. A parameter with
 * several values (a catch-all) becomes `[...name]`.
 *
 * Returns `null` when a value cannot be found in the address. The caller then sends nothing:
 * guessing could put a real value into a report.
 *
 * A value that is equal to a fixed part of the address (`/orders/edit/edit`) can be matched
 * in two places. The last possible place wins, so the same address always gives the same
 * pattern, but it may not be the pattern of the route.
 */
export function routePattern(pathname: string, params: RouteParams): string | null {
  const raw = pathname.split("/").filter((segment) => segment !== "");
  const segments = raw.map(decoded);
  const names = new Array<string | undefined>(segments.length);
  const skip = new Array<boolean>(segments.length).fill(false);

  const entries = Object.entries(params).flatMap(([name, value]) => {
    if (value === undefined) return [];
    const parts = (typeof value === "string" ? [value] : value).map(decoded);
    // An optional catch-all without values is simply not in the address
    if (parts.length === 0) return [];
    return [{ name: typeof value === "string" ? `[${name}]` : `[...${name}]`, parts }];
  });

  // Parameters come in the order of the route, so each one is looked for before the next.
  // Going from the last to the first keeps the fixed parts at the start of an address fixed
  let before = segments.length;
  for (const { name, parts } of entries.reverse()) {
    const start = findLast(segments, parts, before);
    if (start === -1) return null;
    names[start] = name;
    for (let offset = 1; offset < parts.length; offset++) skip[start + offset] = true;
    before = start;
  }

  const pattern =
    "/" +
    raw
      .map((segment, index) => names[index] ?? segment)
      .filter((_, index) => !skip[index])
      .join("/");
  return pattern.length > MAX_ROUTE_LENGTH ? null : pattern;
}

/** What the App Router calls the page for an address that matches no route */
export const NOT_FOUND_ROUTE = "/_not-found";

/** `(marketing)`: a folder that groups routes without being part of the address */
const GROUP = /^\(.*\)$/;
/** `(.)photo`, `(..)(..)photo`: a route that is shown in place of another one */
const INTERCEPT = /^(\(\.{1,3}\))+/;
/** The router's own markers for a page and for the default of a slot */
const MARKER = /^__(PAGE|DEFAULT)__/;

/**
 * The route pattern of the page the App Router rendered, from the segments of its route tree
 * (`useSelectedLayoutSegments()` in the root layout) and the parameters (`useParams()`).
 *
 * The address in the browser is not used on purpose. With a rewrite it differs from what was
 * rendered and can hold values the router knows nothing about (`/share/<token>` shown by a
 * fixed page): those must never end up in a report. The tree only holds folder names and the
 * values of parameters, and the values are replaced by their names.
 *
 * Returns `null` when no pattern can be given, so nothing is sent: without a tree (the Pages
 * Router), or when a parameter is not in the tree, as with a route that is shown over another
 * page in a parallel slot.
 */
export function treePattern(
  segments: readonly string[] | null | undefined,
  params: RouteParams | null | undefined,
): string | null {
  if (!segments || !params) return null;
  // There are no parameters to go by here, and the address itself must not be sent
  if (segments.includes(NOT_FOUND_ROUTE)) return NOT_FOUND_ROUTE;
  const shown = segments
    .filter((segment) => !GROUP.test(segment) && !MARKER.test(segment))
    .map((segment) => segment.replace(INTERCEPT, ""))
    .filter((segment) => segment !== "");
  return routePattern(`/${shown.join("/")}`, params);
}
