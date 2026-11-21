import type { ReactElement, ReactNode } from "react";
import type { Summary } from "../histogram.js";
import { METRICS, THRESHOLDS, type Metric, type Rating } from "../metrics.js";
import type { Overview } from "../overview.js";
import {
  DAY_CHOICES,
  METRIC_NAMES,
  RATING_NAMES,
  formatCount,
  formatDay,
  formatValue,
  hrefWith,
  shares,
  type Filters,
  type SearchParams,
} from "./format.js";
import { STYLES } from "./styles.js";

/** More routes than this are rarely looked at, and a table needs an end */
const MAX_ROWS = 100;

const WIDTH = 240;
const HEIGHT = 40;

/** The 75th percentile per day as a line, with the thresholds as dashed lines */
function Sparkline({ metric, trend }: { metric: Metric; trend: Overview["trend"] }) {
  const values = trend.map((entry) => entry.metrics[metric].p75);
  const known = values.filter((value) => value !== null);
  if (known.length === 0) return <div className="fv-spark" />;
  const { good, poor } = THRESHOLDS[metric];
  const top = Math.max(...known, good) * 1.15;
  const x = (index: number) =>
    values.length === 1 ? WIDTH / 2 : (index / (values.length - 1)) * WIDTH;
  const y = (value: number) => HEIGHT - 2 - (value / top) * (HEIGHT - 4);
  const point = (index: number, value: number) => `${x(index).toFixed(1)} ${y(value).toFixed(1)}`;

  let path = "";
  values.forEach((value, index) => {
    if (value === null) return;
    const joined = index > 0 && values[index - 1] !== null;
    const alone = !joined && (values[index + 1] ?? null) === null;
    // A day between two days without measurements shows as a dot
    path += `${joined ? "L" : "M"}${point(index, value)}${alone ? "h0.01" : ""}`;
  });

  const last = known[known.length - 1]!;
  return (
    <svg
      className="fv-spark"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`75th percentile per day, most recently ${formatValue(metric, last)}`}
    >
      <line className="fv-good" x1="0" x2={WIDTH} y1={y(good)} y2={y(good)} />
      {poor <= top && <line className="fv-poor" x1="0" x2={WIDTH} y1={y(poor)} y2={y(poor)} />}
      <path d={path} />
    </svg>
  );
}

function RatingLabel({ rating }: { rating: Rating | null }) {
  return (
    <p className={`fv-rating${rating ? ` fv-${rating}` : ""}`}>
      <span className="fv-dot" aria-hidden="true" />
      {rating ? RATING_NAMES[rating] : "No measurements"}
    </p>
  );
}

function Card(props: { metric: Metric; summary: Summary; trend: Overview["trend"]; few: number }) {
  const { metric, summary, trend, few } = props;
  const [good, needsImprovement, poor] = shares([
    summary.good,
    summary.needsImprovement,
    summary.poor,
  ]);
  return (
    <li className="fv-card">
      <h3 className="fv-metric">
        {metric}
        <span className="fv-full">{METRIC_NAMES[metric]}</span>
      </h3>
      <p className="fv-value">{summary.p75 === null ? "–" : formatValue(metric, summary.p75)}</p>
      <RatingLabel rating={summary.rating} />
      <div className="fv-bar" aria-hidden="true">
        {summary.count > 0 && (
          <>
            {summary.good > 0 && <span className="fv-good" style={{ flexGrow: summary.good }} />}
            {summary.needsImprovement > 0 && (
              <span
                className="fv-needs-improvement"
                style={{ flexGrow: summary.needsImprovement }}
              />
            )}
            {summary.poor > 0 && <span className="fv-poor" style={{ flexGrow: summary.poor }} />}
          </>
        )}
      </div>
      <p className="fv-small">
        {summary.count > 0
          ? `${good}% good, ${needsImprovement}% needs improvement, ${poor}% poor`
          : "Nothing measured in this period"}
      </p>
      <Sparkline metric={metric} trend={trend} />
      <p className="fv-small">
        {formatCount(summary.count)} {summary.count === 1 ? "measurement" : "measurements"}
        {summary.count > 0 && summary.count < few && <span className="fv-few">few</span>}
      </p>
    </li>
  );
}

function Choices(props: {
  label: string;
  name: string;
  current: string | undefined;
  options: readonly { value: string | undefined; text: string }[];
  searchParams: SearchParams;
}) {
  return (
    <ul className="fv-group" aria-label={props.label}>
      <li className="fv-label" aria-hidden="true">
        {props.label}
      </li>
      {props.options.map(({ value, text }) => (
        <li key={text}>
          <a
            className="fv-choice"
            href={hrefWith(props.searchParams, { [props.name]: value })}
            aria-current={value === props.current ? "true" : undefined}
          >
            {text}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Cell({ metric, summary, few }: { metric: Metric; summary: Summary; few: number }) {
  if (summary.p75 === null || summary.rating === null) return <td className="fv-num">–</td>;
  const unsure = summary.count < few;
  return (
    <td className="fv-num" title={`${formatCount(summary.count)} measurements`}>
      <span className={`fv-cell fv-${summary.rating}${unsure ? " fv-unsure" : ""}`}>
        <span className="fv-dot" aria-hidden="true" />
        {formatValue(metric, summary.p75)}
        <span className="fv-sr">
          {RATING_NAMES[summary.rating]}
          {unsure ? ", few measurements" : ""}
        </span>
      </span>
    </td>
  );
}

export type DashboardViewProps = {
  data: Overview;
  filters: Filters;
  searchParams?: SearchParams;
  /** Default `Web vitals`; `null` leaves the heading out */
  title?: ReactNode;
  /** Fewer measurements than this are marked as few. Default 20 */
  minSamples?: number;
};

/** The dashboard for data that was already read. Plain HTML and CSS, no script. */
export function DashboardView(props: DashboardViewProps): ReactElement {
  const { data, filters, searchParams = {}, title = "Web vitals", minSamples = 20 } = props;
  const dayCount = data.trend.length;
  const rows = data.routes.slice(0, MAX_ROWS);
  return (
    <section className="fv">
      <style href="fieldvitals-dashboard" precedence="default">
        {STYLES}
      </style>
      {title != null && title !== false && <h2 className="fv-title">{title}</h2>}
      <p className="fv-sub">
        {dayCount === 1
          ? formatDay(data.period.to)
          : `${formatDay(data.period.from)} to ${formatDay(data.period.to)}`}{" "}
        (UTC), measured in the browsers of visitors
      </p>

      <nav className="fv-filters" aria-label="Filters">
        <Choices
          label="Period"
          name="days"
          current={String(filters.days)}
          options={DAY_CHOICES.map((days) => ({
            value: String(days),
            text: days === 1 ? "Today" : `${days} days`,
          }))}
          searchParams={searchParams}
        />
        <Choices
          label="Device"
          name="device"
          current={filters.device}
          options={[
            { value: undefined, text: "All" },
            { value: "mobile", text: "Mobile" },
            { value: "desktop", text: "Desktop" },
          ]}
          searchParams={searchParams}
        />
        <Choices
          label="Arrived by"
          name="nav"
          current={filters.nav}
          options={[
            { value: undefined, text: "All" },
            { value: "hard", text: "Page load" },
            { value: "soft", text: "Link inside the site" },
          ]}
          searchParams={searchParams}
        />
      </nav>
      {filters.route !== undefined && (
        <p className="fv-route">
          Showing <code>{filters.route}</code> only.{" "}
          <a href={hrefWith(searchParams, { route: undefined })}>Show all routes</a>
        </p>
      )}

      <ul className="fv-cards">
        {METRICS.map((metric) => (
          <Card
            key={metric}
            metric={metric}
            summary={data.metrics[metric]}
            trend={data.trend}
            few={minSamples}
          />
        ))}
      </ul>

      <h3 className="fv-heading">Routes</h3>
      {rows.length === 0 ? (
        <p className="fv-small">No measurements in this period yet.</p>
      ) : (
        <div className="fv-scroll">
          <table className="fv-table">
            <thead>
              <tr>
                <th scope="col">Route</th>
                <th scope="col" className="fv-num">
                  Measurements
                </th>
                {METRICS.map((metric) => (
                  <th key={metric} scope="col" className="fv-num">
                    <abbr title={METRIC_NAMES[metric]}>{metric}</abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ route, samples, metrics }) => (
                <tr key={route} aria-current={route === filters.route ? "true" : undefined}>
                  <td>
                    <a href={hrefWith(searchParams, { route })}>
                      <code>{route}</code>
                    </a>
                  </td>
                  <td className="fv-num">{formatCount(samples)}</td>
                  {METRICS.map((metric) => (
                    <Cell key={metric} metric={metric} summary={metrics[metric]} few={minSamples} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.routes.length > rows.length && (
        <p className="fv-small">
          The {rows.length} most visited of {formatCount(data.routes.length)} routes.
        </p>
      )}

      <p className="fv-note">
        Each number is the 75th percentile: three out of four visits were at least this fast. Values
        are counted in steps of about 10%, so a number can be off by that much at most; the ratings
        and percentages are exact. Fewer than {minSamples} measurements say little and are marked.
      </p>
    </section>
  );
}
