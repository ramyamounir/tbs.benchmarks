import type {
  Comparison,
  Config,
  ExperimentRow,
  Group,
  RunId,
  Source,
  Verdict,
} from '../../model/types';
import type { SessionState } from '../../state/store';

/*
 * What the Table view shows (pure; spec Phase 5a "Table filter semantics"). Visible runs, visible
 * metrics, the filter chip and the text filter compose; the chip counts are computed on the
 * text-filtered set (so "Regressions 11" always means "11 of the rows matching the text").
 *
 * Visibility sets hold what the user switched OFF (empty = everything shown), so metrics or groups
 * that are added or renamed later show by default: `hiddenGroups` is `session.overview.groups`
 * (shared with the Overview), `hiddenMetrics` is `session.table.metrics` (shared with the Overview).
 */

export type TableChip = SessionState['table']['chip'];
export type TableSort = SessionState['table']['sort'];

export const CHIPS: readonly TableChip[] = ['all', 'regressions', 'improvements', 'missing'];

/** Runs with `hidden === false`, in order. */
export function visibleRuns(runs: Source[]): Source[] {
  return runs.filter((r) => !r.hidden);
}

/**
 * Metric keys that are shown: the group's metrics in its display order (deduplicated, unknown keys
 * dropped) or, without a group, every metric of the config in config order — minus the hidden ones.
 */
export function visibleMetrics(
  config: Config,
  hiddenMetrics: ReadonlySet<string>,
  group?: Group,
): string[] {
  const keys = group ? [...new Set(group.metrics)] : Object.keys(config.metrics);
  return keys.filter((k) => Object.hasOwn(config.metrics, k) && !hiddenMetrics.has(k));
}

/** Case-insensitive substring match on the experiment name; an empty (or blank) filter matches all. */
export function textMatches(name: string, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  return f === '' || name.toLowerCase().includes(f);
}

export interface RowFlags {
  /** Some visible metric in some visible run is `worse` or `mismatch`. */
  regression: boolean;
  /** Some visible metric in some visible run is `better`. */
  improvement: boolean;
  /** No baseline row, or some visible metric in some visible run is `missing`. */
  missing: boolean;
  /** Number of `worse` + `mismatch` cells (sort "most regressions"). */
  regressions: number;
}

export function rowFlags(row: ExperimentRow, runs: Source[], metrics: string[]): RowFlags {
  const flags: RowFlags = {
    regression: false,
    improvement: false,
    missing: row.baseRow.how === 'none',
    regressions: 0,
  };
  for (const run of runs) {
    const cells = row.cells[run.id];
    if (!cells) continue;
    for (const k of metrics) {
      const c = cells[k];
      if (!c) continue;
      if (c.verdict === 'worse' || c.verdict === 'mismatch') {
        flags.regression = true;
        flags.regressions++;
      } else if (c.verdict === 'better') flags.improvement = true;
      else if (c.verdict === 'missing') flags.missing = true;
    }
  }
  return flags;
}

export function chipMatches(flags: RowFlags, chip: TableChip): boolean {
  switch (chip) {
    case 'regressions':
      return flags.regression;
    case 'improvements':
      return flags.improvement;
    case 'missing':
      return flags.missing;
    default:
      return true;
  }
}

/** Per-run summary of one experiment row (collapsed-row chips). */
export interface RunSummary {
  counts: Record<Verdict, number>;
  /** The run has no row for this experiment (or no table for the group). */
  notInRun: boolean;
  /** A `match` metric (e.g. episodes) differs from the baseline. */
  episodes: boolean;
  /** Number of matching rows in the run (> 1 → duplicate chip). */
  rows: number;
}

export function runSummary(row: ExperimentRow, runId: RunId, metrics: string[]): RunSummary {
  const counts: Record<Verdict, number> = { same: 0, better: 0, worse: 0, mismatch: 0, missing: 0 };
  const cells = row.cells[runId] ?? {};
  for (const k of metrics) {
    const c = cells[k];
    if (c) counts[c.verdict]++;
  }
  // Every cell of a run shares the run's row match; any of them tells whether the run has the row.
  const match = Object.values(cells)[0]?.match;
  return {
    counts,
    notInRun: match !== undefined && match.index === null,
    episodes: row.episodesMismatch[runId] === true,
    rows: match?.candidates.length ?? 0,
  };
}

export interface TableRowView {
  row: ExperimentRow;
  flags: RowFlags;
}

export interface TableGroupView {
  group: Group;
  valid: boolean;
  /** Experiments of the group in the comparison (before any filter). */
  total: number;
  /** Visible metric keys of this group, in its display order. */
  metrics: string[];
  rows: TableRowView[];
}

export interface TableModel {
  groups: TableGroupView[];
  /** Row counts per chip, on the text-filtered rows of the shown groups. */
  counts: Record<TableChip, number>;
  /** Rows shown after every filter. */
  shown: number;
}

export interface TableOptions {
  filter: string;
  chip: TableChip;
  sort: TableSort;
  hiddenGroups: ReadonlySet<string>;
  hiddenMetrics: ReadonlySet<string>;
}

function sortRows(rows: TableRowView[], sort: TableSort): TableRowView[] {
  if (sort === 'config') return rows;
  const out = [...rows]; // Array.prototype.sort is stable: ties keep config order
  if (sort === 'name') {
    out.sort((a, b) => (a.row.name < b.row.name ? -1 : a.row.name > b.row.name ? 1 : 0));
  } else {
    out.sort((a, b) => b.flags.regressions - a.flags.regressions);
  }
  return out;
}

/** `runs` are the runs to show (already visible-filtered by the caller via `visibleRuns`). */
export function tableModel(
  cmp: Comparison,
  config: Config,
  runs: Source[],
  opts: TableOptions,
): TableModel {
  const counts: Record<TableChip, number> = {
    all: 0,
    regressions: 0,
    improvements: 0,
    missing: 0,
  };
  const filtering = opts.filter.trim() !== '' || opts.chip !== 'all';
  let shown = 0;
  const groups: TableGroupView[] = [];
  for (const g of cmp.groups) {
    if (opts.hiddenGroups.has(g.group.name)) continue;
    const metrics = visibleMetrics(config, opts.hiddenMetrics, g.group);
    const rows: TableRowView[] = [];
    for (const row of g.experiments) {
      if (!textMatches(row.name, opts.filter)) continue;
      const flags = rowFlags(row, runs, metrics);
      counts.all++;
      if (flags.regression) counts.regressions++;
      if (flags.improvement) counts.improvements++;
      if (flags.missing) counts.missing++;
      if (chipMatches(flags, opts.chip)) rows.push({ row, flags });
    }
    shown += rows.length;
    // An empty group stays visible while nothing filters (so it is not silently dropped).
    if (rows.length === 0 && filtering) continue;
    groups.push({
      group: g.group,
      valid: g.valid,
      total: g.experiments.length,
      metrics,
      rows: sortRows(rows, opts.sort),
    });
  }
  return { groups, counts, shown };
}

export type MarkdownScope = { kind: 'all' } | { kind: 'visible' } | { kind: 'group'; name: string };

/**
 * The comparison restricted for the Markdown report (the caller passes it to `renderMarkdown`
 * together with the visible runs, so no Markdown is ever built here). Every scope keeps only the
 * visible metrics; `all` keeps every experiment of every group, `visible` exactly the rows the table
 * shows (groups, text filter, chip, sort order), `group` every experiment of that one group.
 */
export function markdownComparison(
  cmp: Comparison,
  config: Config,
  model: TableModel,
  hiddenMetrics: ReadonlySet<string>,
  scope: MarkdownScope,
): Comparison {
  const restrict = (group: Group): Group => ({
    ...group,
    metrics: visibleMetrics(config, hiddenMetrics, group),
  });
  let groups: Comparison['groups'];
  if (scope.kind === 'visible') {
    groups = model.groups
      .filter((g) => g.rows.length > 0)
      .map((g) => ({
        group: restrict(g.group),
        valid: g.valid,
        experiments: g.rows.map((r) => r.row),
      }));
  } else {
    groups = cmp.groups
      .filter((g) => scope.kind === 'all' || g.group.name === scope.name)
      .map((g) => ({ ...g, group: restrict(g.group) }));
  }
  return { ...cmp, groups };
}

/** Number of experiment rows a Markdown scope would contain. */
export function experimentCount(cmp: Comparison): number {
  return cmp.groups.reduce((n, g) => n + g.experiments.length, 0);
}
