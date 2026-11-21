import type { ReactElement, ReactNode } from "react";
import { filtersFrom, type SearchParams } from "./dashboard/format.js";
import { DashboardView } from "./dashboard/view.js";
import { overview } from "./overview.js";
import type { Store } from "./store.js";

export { DashboardView } from "./dashboard/view.js";
export type { DashboardViewProps } from "./dashboard/view.js";
export { filtersFrom } from "./dashboard/format.js";
export type { Filters, SearchParams } from "./dashboard/format.js";

export type DashboardProps = {
  store: Store;
  /**
   * The `searchParams` of the page, as they are or as the promise Next gives. The filters are
   * links that change `days`, `device`, `nav` and `route` in the address. Without it the
   * dashboard always shows everything
   */
  searchParams?: SearchParams | Promise<SearchParams>;
  /** The period when the address does not say. Default 28 */
  days?: number;
  /** Fewer measurements than this are marked as few. Default 20 */
  minSamples?: number;
  /** The heading. Default `Web vitals`; `null` leaves it out, for a page with its own heading */
  title?: ReactNode;
  /** The current time, for tests */
  now?: () => Date;
};

/**
 * A page of web vitals from the store: the 75th percentile per metric with its rating, the
 * spread over good, needs improvement and poor, the course per day and a table per route.
 *
 * A server component: it reads the store while rendering and sends no script to the browser.
 * Put it on a page that only the right people can open; it does no access check itself.
 */
export async function Dashboard(props: DashboardProps): Promise<ReactElement> {
  const searchParams = (await props.searchParams) ?? {};
  const filters = filtersFrom(searchParams, props.days ?? 28);
  const data = await overview(props.store, { ...filters, now: props.now });
  return (
    <DashboardView
      data={data}
      filters={filters}
      searchParams={searchParams}
      title={props.title}
      minSamples={props.minSamples}
    />
  );
}
