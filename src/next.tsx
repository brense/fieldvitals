"use client";

import { useParams, usePathname, useSelectedLayoutSegments } from "next/navigation.js";
import { useReportWebVitals } from "next/web-vitals.js";
import { Suspense, useEffect } from "react";
import { createCollector, type Collector, type VitalsMetric } from "./collector.js";
import type { Device } from "./protocol.js";
import { treePattern } from "./route.js";

export type FieldVitalsProps = {
  /** Where reports go. Default `/api/vitals`. Must be on the site's own origin */
  endpoint?: string;
  /** Share of page loads that is measured, from 0 to 1. Default 1 */
  sampleRate?: number;
};

/** One per document. `null`: this page load is not in the sample */
let collector: Collector | null | undefined;

function device(): Device {
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (typeof data?.mobile === "boolean") return data.mobile ? "mobile" : "desktop";
  return /Mobi/i.test(navigator.userAgent) ? "mobile" : "desktop";
}

function landing(): string {
  try {
    const entry = performance.getEntriesByType("navigation")[0];
    if (entry) return new URL(entry.name).pathname;
  } catch {
    // Fall through
  }
  return location.pathname;
}

function start(endpoint: string, sampleRate: number) {
  if (collector !== undefined) return;
  if (!(Math.random() < sampleRate)) {
    collector = null;
    return;
  }
  const started = createCollector({
    send(body) {
      try {
        // Keeps going after the page is gone, which fetch only does with keepalive
        if (navigator.sendBeacon?.(endpoint, body)) return;
      } catch {
        // Fall through
      }
      try {
        void fetch(endpoint, {
          method: "POST",
          body,
          keepalive: true,
          credentials: "omit",
        }).catch(() => {});
      } catch {
        // Nowhere left to report to
      }
    },
    device,
    hidden: () => document.visibilityState === "hidden",
    landing,
    later: (run, ms) => void setTimeout(run, ms),
  });
  collector = started;
  // The last moment a browser reliably gives, on a phone often the only one, and also what
  // happens when a page is left or closed. The web-vitals library settles its values in a
  // listener that runs before this one, so one report holds everything
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") started.flush();
  });
}

/** Never changes, so `useReportWebVitals` subscribes once */
function report(metric: VitalsMetric) {
  collector?.report(metric);
}

function Route({ endpoint, sampleRate }: Required<FieldVitalsProps>) {
  const pathname = usePathname();
  // What was rendered, not the address in the browser: after a rewrite those differ, and the
  // address may hold values that must not be sent
  const pattern = treePattern(useSelectedLayoutSegments(), useParams());

  useEffect(() => {
    start(endpoint, sampleRate);
    // Measurements carry the address they were taken on. It only serves to find the pattern
    // that belongs to them and is never sent
    collector?.setRoute(location.pathname, pattern);
  }, [endpoint, sampleRate, pathname, pattern]);
  return null;
}

/**
 * Measures the web vitals of real visits and sends them to the site's own endpoint: one small
 * report per page view, with the route pattern (`/orders/[id]/edit`) and never the address.
 * Put it in the root layout.
 *
 * `endpoint` and `sampleRate` are read once per page load.
 */
export function FieldVitals({ endpoint = "/api/vitals", sampleRate = 1 }: FieldVitalsProps) {
  useEffect(() => start(endpoint, sampleRate), [endpoint, sampleRate]);
  useReportWebVitals(report);
  return (
    // Reading the address can suspend while a page is prerendered
    <Suspense fallback={null}>
      <Route endpoint={endpoint} sampleRate={sampleRate} />
    </Suspense>
  );
}
