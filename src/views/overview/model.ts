import type {
  Cell,
  Comparison,
  Config,
  ExperimentRow,
  Group,
  Metric,
  Source,
} from '../../model/types';
import { formatFixed } from '../../model/format';
import type { SessionState } from '../../state/store';

/**
 * What the Overview heatmap shows (pure; spec Phase 3 Overview + "SHOW" toggles): the groups the
 * user did not uncheck, their rows after the Show filters, and the metric columns shared by every
 * run block (the union of the shown groups' metrics, in config order, minus the metrics unchecked
 * in the Table sidebar — `session.table.metrics`, the metric visibility both views share).
 */

export interface HeatGroup {
  group: Group;
  valid: boolean;
  rows: ExperimentRow[];
  total: number;
}

export interface OverviewModel {
  groups: HeatGroup[];
  metrics: string[];
}

const CHANGED = new Set(['better', 'worse', 'mismatch']);
const REGRESSED = new Set(['worse', 'mismatch']);

function cellsOf(row: ExperimentRow, runs: Source[], metrics: string[]): Cell[] {
  const out: Cell[] = [];
  for (const r of runs) {
    const cells = row.cells[r.id];
    if (!cells) continue;
    for (const k of metrics) if (cells[k]) out.push(cells[k]);
  }
  return out;
}

/** No baseline row, or no visible run has a matched row for any metric. */
export function isMissingRow(row: ExperimentRow, runs: Source[], metrics: string[]): boolean {
  if (row.baseRow.index === null) return true;
  const cells = cellsOf(row, runs, metrics);
  return cells.length > 0 && cells.every((c) => c.verdict === 'missing');
}

export function overviewModel(
  cmp: Comparison,
  config: Config,
  runs: Source[],
  ov: SessionState['overview'],
  hiddenMetrics: ReadonlySet<string> = new Set(),
): OverviewModel {
  const shown = cmp.groups.filter((g) => !ov.groups.has(g.group.name));
  const used = new Set<string>();
  for (const g of shown) for (const k of g.group.metrics) used.add(k);
  let metrics = Object.keys(config.metrics).filter((k) => used.has(k) && !hiddenMetrics.has(k));

  const groups = shown.map((g) => {
    let rows = g.experiments;
    if (!ov.includeMissing) rows = rows.filter((r) => !isMissingRow(r, runs, metrics));
    if (ov.onlyRegressions) {
      rows = rows.filter((r) => cellsOf(r, runs, metrics).some((c) => REGRESSED.has(c.verdict)));
    }
    return { group: g.group, valid: g.valid, rows, total: g.experiments.length };
  });

  if (ov.hideWithinTol) {
    metrics = metrics.filter((k) =>
      groups.some((g) =>
        g.rows.some((r) => cellsOf(r, runs, [k]).some((c) => CHANGED.has(c.verdict))),
      ),
    );
  }
  return { groups, metrics };
}

/** Value for display with the metric's decimals; '—' for no value. */
export function formatValue(x: number | null, metric: Metric): string {
  return x === null ? '—' : formatFixed(x, metric.decimals);
}

/** Signed Δ with a real minus sign: "+0.12", "−2.29", "±0.00". */
export function formatDelta(d: number | null, metric: Metric): string {
  if (d === null) return '—';
  const t = formatFixed(Math.abs(d), metric.decimals);
  if (/^[0.]*$/.test(t)) return `±${t}`;
  return `${d < 0 ? '−' : '+'}${t}`;
}

export function directionText(metric: Metric): string {
  return metric.direction === 'higher'
    ? 'higher is better'
    : metric.direction === 'lower'
      ? 'lower is better'
      : 'must match';
}

export function toleranceText(metric: Metric): string {
  return metric.tolerance_mode === 'percent'
    ? `tol ${metric.tolerance} %`
    : `tol ${metric.tolerance}`;
}
