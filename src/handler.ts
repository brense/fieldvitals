import { parseReport, toCounts, utcDay } from "./protocol.js";
import { ready } from "./ready.js";
import type { Store } from "./store.js";

/** Reports for routes beyond `maxRoutes` are counted under this name */
export const OTHER_ROUTE = "(other)";

export type HandlerOptions = {
  store: Store;
  /**
   * How many different routes a day may get. Reports for more are counted as `(other)`, so
   * made-up routes cannot fill the database. Default 200
   */
  maxRoutes?: number;
  /** Reports accepted per minute, per server process. Default 600 */
  maxPerMinute?: number;
  /**
   * How many days of counts to keep. Once a day the handler removes what is older. `false`
   * keeps everything, and so does a number below 1. Default 400
   */
  keepDays?: number | false;
  /** Leaves out reports from crawlers and test tools, going by their user agent. Default true */
  ignoreBots?: boolean;
  /**
   * Called when the store fails. The browser gets a 500 when its report could not be stored;
   * a failed clean-up of old days does not change the answer
   */
  onError?: (error: unknown) => void;
  /** The current time, for tests */
  now?: () => Date;
};

/** A report is a few hundred bytes */
const MAX_BODY_BYTES = 2048;
const DAY_MS = 86_400_000;
const BOTS =
  /bot|crawl|spider|slurp|lighthouse|pagespeed|headless|gtmetrix|pingdom|ptst|statuscake|uptime/i;

function answer(status: number, text?: string, headers?: Record<string, string>): Response {
  return new Response(text ?? null, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/**
 * Whether the request comes from a page of the site itself. Browsers set these headers and
 * pages cannot change them, so other sites cannot make their visitors send reports.
 */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwarded || request.headers.get("host") || new URL(request.url).host;
    const from = new URL(origin);
    // Through URL, so capitals and the default port of the scheme make no difference
    return from.host === new URL(`${from.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

/** The body as text, or `null` when it is larger than a report can be */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * The endpoint browsers send their reports to. Give the result to the server as the handler
 * for `POST`; in Next that is `export const POST = createHandler({ store })` in a `route.ts`.
 *
 * It only takes reports from pages of the site itself and keeps nothing but counts: no IP
 * address, no user agent, no cookies. It never throws.
 */
export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  const { store, onError } = options;
  const maxRoutes = options.maxRoutes ?? 200;
  const maxPerMinute = options.maxPerMinute ?? 600;
  const ignoreBots = options.ignoreBots ?? true;
  const wanted = options.keepDays ?? 400;
  // Anything that is not a whole number of days keeps everything: removing too much cannot be undone
  const keepDays =
    wanted !== false && Number.isFinite(wanted) && wanted >= 1 ? Math.floor(wanted) : false;
  const now = options.now ?? (() => new Date());

  let minute = 0;
  let inMinute = 0;
  function underLimit(moment: Date): boolean {
    const current = Math.floor(moment.getTime() / 60_000);
    if (current !== minute) {
      minute = current;
      inMinute = 0;
    }
    return ++inMinute <= maxPerMinute;
  }

  let routesDay = "";
  let routes: Promise<Set<string>> | undefined;
  /** The routes that have counts today. Other server processes may add some in the meantime */
  function routesOf(day: string): Promise<Set<string>> {
    if (!routes || routesDay !== day) {
      routesDay = day;
      const reading = store.routes({ from: day, to: day }).then((found) => new Set(found));
      routes = reading;
      reading.catch(() => {
        if (routes === reading) routes = undefined;
      });
    }
    return routes;
  }

  function tell(error: unknown) {
    try {
      onError?.(error);
    } catch {
      // A failing error handler must not hide the answer
    }
  }

  let prunedOn = "";
  /** Removes the days that are too old, once per day and server process */
  async function prune(moment: Date, day: string) {
    if (keepDays === false || prunedOn === day) return;
    prunedOn = day;
    try {
      const oldest = new Date(moment.getTime() - keepDays * DAY_MS);
      // More days than a date can go back: nothing is that old
      if (Number.isNaN(oldest.getTime())) return;
      await store.prune(utcDay(oldest));
    } catch (error) {
      tell(error);
    }
  }

  return async function handle(request) {
    try {
      if (request.method !== "POST") return answer(405, "POST only", { Allow: "POST" });
      if (!sameOrigin(request)) return answer(403, "same origin only");
      const moment = now();
      if (!underLimit(moment)) return answer(429, "too many reports");

      const body = await readBody(request);
      if (body === null) return answer(413, "too large");
      let input: unknown;
      try {
        input = JSON.parse(body);
      } catch {
        return answer(400, "not JSON");
      }
      const parsed = parseReport(input);
      if (!parsed.ok) return answer(400, parsed.reason);

      // Looked at here and nowhere else: the user agent is not kept
      const agent = request.headers.get("user-agent") ?? "";
      if (ignoreBots && (agent === "" || BOTS.test(agent))) return answer(204);

      try {
        await ready(store);
        const day = utcDay(moment);
        const known = await routesOf(day);
        let { report } = parsed;
        if (!known.has(report.route) && known.size >= maxRoutes) {
          report = { ...report, route: OTHER_ROUTE };
        }
        await store.add(toCounts(report, day));
        // Only now, so a route whose counts were not stored does not use up a place
        if (report.route !== OTHER_ROUTE) known.add(report.route);
        await prune(moment, day);
      } catch (error) {
        tell(error);
        return answer(500, "could not store");
      }
      return answer(204);
    } catch {
      return answer(400, "bad request");
    }
  };
}
