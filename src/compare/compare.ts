import { applyTransforms } from '../model/transforms';
import type {
  Cell,
  Comparison,
  Config,
  Coverage,
  ExperimentRow,
  Group,
  Metric,
  RowMatch,
  RunId,
  Source,
  Table,
  Verdict,
} from '../model/types';
import { findRows, idIndex } from './match';

/**
 * The comparison engine (spec Phase 2a "Verdict", "Comparison result", "Duplicates", "Table
 * lookup"): the single source of truth for every number the views show. Pure, never throws for
 * any structurally valid Config (including rejected user regexes, which yield `missing` cells).
 */

export const VERDICTS: readonly Verdict[] = ['same', 'better', 'worse', 'mismatch', 'missing'];

/**
 * Which table of `source` a group reads: a repo source reads `group.table` (null when absent or
 * when the config has no repo side); a wandb source always reads its single export.
 */
export function groupTable(group: Group, source: Source): Table | null {
  if (source.kind === 'wandb') return source.tables[0] ?? null;
  if (group.table === null) return null;
  return source.tables.find((t) => t.path === group.table) ?? null;
}

/** Key of `session.rowChoices` (and of `chooseRow`). */
export function rowChoiceKey(sourceId: RunId, tablePath: string, experiment: string): string {
  return `${sourceId}\u0000${tablePath}\u0000${experiment}`;
}

const NO_MATCH: RowMatch = { how: 'none', index: null, candidates: [], chosen: null };

function matchRow(
  config: Config,
  group: Group,
  source: Source,
  table: Table | null,
  name: string,
  rowChoices: Record<string, number>,
): RowMatch {
  if (table === null) return NO_MATCH;
  const kind = config.sources[source.kind];
  const { indices, how } = findRows(table, kind.id_column, name, group.match ?? kind.match);
  if (indices.length === 0) return NO_MATCH;
  // A stored choice is a table row index; it is used only while it is still one of the matches.
  let chosen = indices[0];
  const key = rowChoiceKey(source.id, table.path, name);
  if (Object.hasOwn(rowChoices, key)) {
    const r = rowChoices[key];
    if (indices.includes(r)) chosen = r;
  }
  return { how, index: chosen, candidates: indices, chosen };
}

/** One metric's value for a matched row; null when anything is missing or not a number. */
function metricValue(
  group: Group,
  metricKey: string,
  metric: Metric,
  source: Source,
  table: Table | null,
  match: RowMatch,
): number | null {
  if (table === null || match.index === null) return null;
  const spec = Object.hasOwn(metric.columns, source.kind) ? metric.columns[source.kind] : undefined;
  if (!spec) return null;
  let column = spec.column;
  if (Object.hasOwn(group.column_overrides, metricKey)) {
    const o = group.column_overrides[metricKey];
    if (Object.hasOwn(o, source.kind) && typeof o[source.kind] === 'string') {
      column = o[source.kind] as string;
    }
  }
  const c = table.csv.header.indexOf(column);
  const raw = c < 0 ? undefined : (table.csv.rows[match.index][c] ?? '');
  const v = applyTransforms(raw, spec.transforms);
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

export function verdictOf(metric: Metric, base: number | null, value: number | null): Verdict {
  if (base === null || value === null) return 'missing';
  const tol =
    metric.tolerance_mode === 'percent'
      ? (Math.abs(base) * metric.tolerance) / 100
      : metric.tolerance;
  if (Math.abs(value - base) <= tol) return 'same';
  if (metric.direction === 'match') return 'mismatch';
  return (metric.direction === 'higher') === value > base ? 'better' : 'worse';
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

/** Metric keys of a group that exist in the config (own keys only; others are skipped). */
function groupMetricKeys(config: Config, group: Group, only?: string): string[] {
  return unique(group.metrics).filter(
    (k) => (only === undefined || k === only) && Object.hasOwn(config.metrics, k),
  );
}

/**
 * The shared inner loop of compareAll and compareMetric (so they can never disagree): one
 * ExperimentRow per (deduplicated) experiment of the group, cells for `metricKeys` only.
 */
function compareGroup(
  config: Config,
  group: Group,
  metricKeys: string[],
  baseline: Source,
  runs: Source[],
  rowChoices: Record<string, number>,
): ExperimentRow[] {
  const baseTable = groupTable(group, baseline);
  const runTables = runs.map((r) => groupTable(group, r));
  return unique(group.experiments).map((name) => {
    const baseRow = matchRow(config, group, baseline, baseTable, name, rowChoices);
    const bases = metricKeys.map((k) =>
      metricValue(group, k, config.metrics[k], baseline, baseTable, baseRow),
    );
    const cells: ExperimentRow['cells'] = {};
    const episodesMismatch: ExperimentRow['episodesMismatch'] = {};
    runs.forEach((run, ri) => {
      const table = runTables[ri];
      const match = matchRow(config, group, run, table, name, rowChoices);
      const byMetric: Record<string, Cell> = {};
      let mismatch = false;
      metricKeys.forEach((k, mi) => {
        const metric = config.metrics[k];
        const base = bases[mi];
        const value = metricValue(group, k, metric, run, table, match);
        const delta = base !== null && value !== null ? value - base : null;
        const verdict = verdictOf(metric, base, value);
        if (metric.direction === 'match' && verdict === 'mismatch') mismatch = true;
        byMetric[k] = { base, value, delta, verdict, match };
      });
      cells[run.id] = byMetric;
      episodesMismatch[run.id] = mismatch;
    });
    return { name, group: group.name, baseRow, cells, episodesMismatch };
  });
}

/**
 * Experiments listed in the config with no baseline row, per group (in config order, deduplicated).
 * `name ∈ missing` ⇔ `baseRow.how === 'none'`.
 */
export function missingExperiments(config: Config, baseline: Source): Comparison['missing'] {
  const out: Comparison['missing'] = [];
  const kind = config.sources[baseline.kind];
  for (const group of config.groups) {
    const table = groupTable(group, baseline);
    const names = unique(group.experiments).filter(
      (name) =>
        table === null ||
        findRows(table, kind.id_column, name, group.match ?? kind.match).indices.length === 0,
    );
    if (names.length > 0) out.push({ group: group.name, names });
  }
  return out;
}

/**
 * Ids present in a loaded table but matched by no experiment of any group that reads that table,
 * per source and table, in file order (nothing is silently dropped).
 */
export function unassignedExperiments(config: Config, sources: Source[]): Comparison['unassigned'] {
  const out: Comparison['unassigned'] = [];
  for (const source of sources) {
    const kind = config.sources[source.kind];
    for (const table of source.tables) {
      const assigned = new Set<number>();
      for (const group of config.groups) {
        if (groupTable(group, source) !== table) continue;
        for (const name of group.experiments) {
          const found = findRows(table, kind.id_column, name, group.match ?? kind.match);
          for (const i of found.indices) assigned.add(i);
        }
      }
      const names: string[] = [];
      for (const [key, rows] of idIndex(table, kind.id_column)) {
        if (key !== '' && rows.some((i) => !assigned.has(i))) names.push(key);
      }
      if (names.length > 0) out.push({ table: table.path, sourceId: source.id, names });
    }
  }
  return out;
}

function emptyCounts(): Record<Verdict, number> {
  return { same: 0, better: 0, worse: 0, mismatch: 0, missing: 0 };
}

/** Compare every group × experiment × run × metric of `config`. */
export function compareAll(
  config: Config,
  baseline: Source,
  runs: Source[],
  rowChoices: Record<string, number>,
): Comparison {
  const groups = config.groups.map((group) => ({
    group,
    valid: groupTable(group, baseline) !== null,
    experiments: compareGroup(
      config,
      group,
      groupMetricKeys(config, group),
      baseline,
      runs,
      rowChoices,
    ),
  }));

  const runStats = runs.map((source) => {
    const counts = emptyCounts();
    let found = 0;
    let total = 0;
    for (const g of groups) {
      for (const row of g.experiments) {
        total++;
        const cells = row.cells[source.id];
        let matched = false;
        for (const k of Object.keys(cells)) {
          counts[cells[k].verdict]++;
          if (cells[k].match.index !== null) matched = true;
        }
        if (!matched && Object.keys(cells).length === 0) {
          // A group without metrics still tells whether the row exists.
          matched =
            matchRow(config, g.group, source, groupTable(g.group, source), row.name, rowChoices)
              .index !== null;
        }
        if (matched) found++;
      }
    }
    const coverage: Coverage = { found, total, partial: total > 0 && found / total < 0.5 };
    return { source, coverage, counts };
  });

  return {
    groups,
    runs: runStats,
    unassigned: unassignedExperiments(config, [baseline, ...runs]),
    missing: missingExperiments(config, baseline),
  };
}

/**
 * The cells of one metric (every group that lists it), computed by the same inner loop as
 * compareAll. Used by the metric editor's impact line. When an experiment is in several groups
 * that list the metric, the first group wins.
 */
export function compareMetric(
  config: Config,
  metricKey: string,
  baseline: Source,
  runs: Source[],
  rowChoices: Record<string, number>,
): Record<RunId, Record<string, Cell>> {
  const out: Record<RunId, Record<string, Cell>> = {};
  for (const run of runs) out[run.id] = {};
  if (!Object.hasOwn(config.metrics, metricKey)) return out;
  for (const group of config.groups) {
    const keys = groupMetricKeys(config, group, metricKey);
    if (keys.length === 0) continue;
    for (const row of compareGroup(config, group, keys, baseline, runs, rowChoices)) {
      for (const run of runs) {
        if (!Object.hasOwn(out[run.id], row.name))
          out[run.id][row.name] = row.cells[run.id][metricKey];
      }
    }
  }
  return out;
}
