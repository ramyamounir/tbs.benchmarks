import { formatFixed } from '../model/format';
import type {
  ChartDef,
  Comparison,
  Config,
  Direction,
  Metric,
  RunId,
  Source,
  Verdict,
} from '../model/types';

/*
 * Chart data preparation (spec Phase 5b). Pure: every chart component takes a `ChartData` built
 * here from the `Comparison`, so charts never recompute verdicts or tolerances themselves
 * ("Tolerance in charts").
 */

// Same formula as the Phase 2a "Verdict" `tol` (and Phase 3 `heatStep`), so a band edge is exactly the same/changed boundary.
export function effectiveTol(metric: Metric, base: number | null): number | null {
  if (metric.tolerance_mode === 'absolute') return metric.tolerance;
  if (base == null || !Number.isFinite(base)) return null; // no baseline value → no band for that experiment
  return (Math.abs(base) * metric.tolerance) / 100;
}

/** Subtitle part: `tolerance ±0.1` (absolute) or `tolerance ±5 %` (percent of the baseline). */
export function toleranceLabel(metric: Metric): string {
  return metric.tolerance_mode === 'absolute'
    ? `tolerance ±${metric.tolerance}`
    : `tolerance ±${metric.tolerance} %`;
}

/** The DeltaDots x axis always runs from negative Δ (left) to positive Δ (right). */
export function deltaAxisLabel(direction: Direction): string {
  switch (direction) {
    case 'higher':
      return '← worse · better →';
    case 'lower':
      return '← better · worse →';
    case 'match':
      return '← lower · higher →';
  }
}

export function toleranceFootnote(metric: Metric): string {
  const what = metric.direction === 'match' ? 'must match' : 'tolerance';
  return metric.tolerance_mode === 'absolute'
    ? `Grey band = ${what} (±${metric.tolerance}). Click a dot to open the experiment.`
    : `Grey band = ${what} (±${metric.tolerance} % of baseline, per experiment). Click a dot to open the experiment.`;
}

export const TREND_FOOTNOTE = 'x-axis in run date order, oldest first';

// ---- ChartData ----

/** One drawn series: the baseline (`colorIndex -1`) or a visible run. */
export interface ChartSeries {
  id: RunId;
  label: string;
  /** Index into `sources.runs` (stable run colour / marker even when others are hidden); -1 = baseline. */
  colorIndex: number;
  /** Source date (epoch ms) for the trend order; null = unknown (and for the baseline). */
  date: number | null;
}

export interface ChartPoint {
  value: number | null;
  delta: number | null;
  verdict: Verdict;
}

export interface ChartEntry {
  name: string;
  group: string;
  base: number | null;
  effectiveTol: number | null;
  /** One point per visible run (key = run id); a run without a cell has a `missing` point. */
  points: Record<RunId, ChartPoint>;
}

export interface ChartData {
  metricKey: string;
  metric: Metric | null; // null: the chart's metric is not in the config
  group: string;
  groupFound: boolean;
  metricInGroup: boolean;
  toleranceMode: Metric['tolerance_mode'];
  direction: Direction;
  baseline: ChartSeries;
  runs: ChartSeries[]; // visible runs in sidebar order
  entries: ChartEntry[];
}

/** Series id of the baseline (never a Source id: those are generated ids, not this string). */
export const BASELINE_ID = '\u0000baseline';

const MISSING: ChartPoint = { value: null, delta: null, verdict: 'missing' };

/**
 * The data of one chart: the experiments of `chart.group` (all, or the ones in
 * `chart.experiments`, always in group order), with the baseline value, the effective tolerance and
 * one point per visible run.
 */
export function buildChartData(
  cmp: Comparison,
  config: Config,
  chart: ChartDef,
  visible: Source[],
  allRuns: Source[],
  baselineLabel = 'baseline',
): ChartData {
  const metric = Object.hasOwn(config.metrics, chart.metric) ? config.metrics[chart.metric] : null;
  const cg = cmp.groups.find((g) => g.group.name === chart.group);
  const metricInGroup = cg !== undefined && cg.group.metrics.includes(chart.metric);
  const wanted = chart.experiments === null ? null : new Set(chart.experiments);
  const entries: ChartEntry[] = [];
  for (const row of cg?.experiments ?? []) {
    if (wanted !== null && !wanted.has(row.name)) continue;
    let base: number | null = null;
    const points: Record<RunId, ChartPoint> = {};
    for (const cells of Object.values(row.cells)) {
      const c = cells[chart.metric];
      if (c && c.base !== null) {
        base = c.base;
        break;
      }
    }
    for (const r of visible) {
      const c = row.cells[r.id]?.[chart.metric];
      points[r.id] = c ? { value: c.value, delta: c.delta, verdict: c.verdict } : MISSING;
    }
    entries.push({
      name: row.name,
      group: row.group,
      base,
      effectiveTol: metric ? effectiveTol(metric, base) : null,
      points,
    });
  }
  return {
    metricKey: chart.metric,
    metric,
    group: chart.group,
    groupFound: cg !== undefined,
    metricInGroup,
    toleranceMode: metric?.tolerance_mode ?? 'absolute',
    direction: metric?.direction ?? 'higher',
    baseline: { id: BASELINE_ID, label: baselineLabel, colorIndex: -1, date: null },
    runs: visible.map((r) => ({
      id: r.id,
      label: r.label,
      colorIndex: allRuns.indexOf(r),
      date: r.date,
    })),
    entries,
  };
}

/**
 * Trend x order: visible runs by date, oldest first; runs with an unknown date keep their sidebar
 * order after the dated ones (stable).
 */
export function trendOrder<T extends { date: number | null }>(runs: T[]): T[] {
  return runs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const da = a.r.date;
      const db = b.r.date;
      if (da === null && db === null) return a.i - b.i;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db || a.i - b.i;
    })
    .map((x) => x.r);
}

// ---- Labels ----

/** Bar labels use at most one decimal (mockup: 29.27 → "29.3"), the metric's decimals otherwise. */
function labelDecimals(metric: Metric): number {
  return Math.min(metric.decimals, 1);
}

/** Value label on a bar: "29.3". */
export function barLabel(value: number | null, metric: Metric): string {
  return value === null ? 'n/a' : formatFixed(value, labelDecimals(metric));
}

/** Compact Δ label: "−1.4", "+1.8", "±0" (a Δ that rounds to zero). Real minus sign. */
export function deltaLabel(delta: number | null, metric: Metric): string {
  if (delta === null) return '—';
  const t = formatFixed(Math.abs(delta), labelDecimals(metric));
  if (/^[0.]*$/.test(t)) return '±0';
  return `${delta < 0 ? '−' : '+'}${t}`;
}

/** Card title when the definition has none, e.g. "Rotation error by experiment". */
export function defaultTitle(chart: ChartDef, metric: Metric | null): string {
  const label = metric?.label ?? chart.metric;
  switch (chart.type) {
    case 'grouped_bars':
      return `${label} by experiment`;
    case 'delta_dots':
      return `Δ ${label} vs baseline`;
    case 'small_multiples':
      return `${label} per experiment`;
    case 'trend':
      return `${label} across runs`;
  }
}

/** "lower is better" / "higher is better" / "must match". */
export function directionLabel(direction: Direction): string {
  return direction === 'higher'
    ? 'higher is better'
    : direction === 'lower'
      ? 'lower is better'
      : 'must match';
}

/**
 * Subtitle parts after the group name: units (when set), direction, tolerance. The group name is
 * file-derived and rendered separately through <DisplayName>.
 */
export function subtitleParts(metric: Metric): string[] {
  return [
    ...(metric.units ? [metric.units] : []),
    directionLabel(metric.direction),
    toleranceLabel(metric),
  ];
}
