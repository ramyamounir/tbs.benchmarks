import { formatFixed } from '../model/format';
import type {
  Comparison,
  Config,
  Group,
  Metric,
  RunId,
  Source,
  SourceKind,
  Table,
  Transform,
} from '../model/types';
import { groupTable } from '../compare/compare';

/**
 * Write-back planning (spec Phase 6 "Writable cells", "Plan options mapping", "Kept keys"): which
 * baseline cells would take the run's value, formatted like the existing cell (port of v1
 * `format_value_like_baseline`). Pure: the files are rewritten later, only through `rewriteRows`.
 */

export type WritebackSkip = 'tolerance' | 'episodes' | 'kept' | 'non-numeric' | 'transform';

export interface WritebackEntry {
  rowIndex: number; // index into table.csv.rows
  columnIndex: number; // index into table.csv.header (the field index of the record)
  column: string; // the file's raw header string, e.g. 'Correct (%)|align right'
  old: string;
  new: string; // equals `old` for skip reasons 'transform' and 'non-numeric'
  experiment: string;
  metric: string;
  skipped?: WritebackSkip;
}

export interface WritebackTablePlan {
  path: string; // Table.path in the baseline source
  table: Table;
  entries: WritebackEntry[];
  /** Config experiments of this table with a baseline row (rows considered). */
  experiments: number;
  /** Of those, the experiments with no row in the run (no entries, as in v1). */
  notInRun: string[];
  /** Header strings of the metric columns `isWritableMetric` rejects. */
  unwritable: string[];
}

export interface WritebackPlan {
  runId: RunId;
  tables: WritebackTablePlan[];
}

export interface WritebackOptions {
  keepFormatting: boolean;
  skipWithinTol: boolean;
  skipEpisodeMismatch: boolean;
  kept: Set<string>;
}

/** Baseline-side transforms that change the unit or the text, so the run value cannot be copied. */
export const UNWRITABLE_TRANSFORMS: ReadonlySet<Transform['kind']> = new Set<Transform['kind']>([
  'rad_to_deg',
  'deg_to_rad',
  'sec_to_min',
  'min_to_sec',
  'frac_to_percent',
  'percent_to_frac',
  'scale',
  'lowercase',
  'uppercase',
  'strip_prefix',
  'strip_suffix',
  'regex_replace',
]);

export function isWritableMetric(metric: Metric, kind: SourceKind): boolean {
  const spec = Object.hasOwn(metric.columns, kind) ? metric.columns[kind] : undefined;
  return (spec?.transforms ?? []).every((t) => !UNWRITABLE_TRANSFORMS.has(t.kind));
}

/** Key of `session.writeback.kept`; scoped to the run so another run never inherits it. */
export function keptKey(runId: RunId, tablePath: string, experiment: string, column: string) {
  return `${runId}\u0000${tablePath}\u0000${experiment}\u0000${column}`;
}

// v1 `_NUM_RE`.
const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
const PLAIN_NUM = /^-?\d+(\.\d+)?$/;
const PLAIN_CELL = /^-?\d+(\.\d+)?%?$/;
// formatFixed (toFixed underneath) accepts at most 100 digits after adding its guard digits.
const MAX_DECIMALS = 75;

/**
 * The number text both formatters write: Python `f'{x:.{d}f}'`, negative zero normalised to zero
 * (documented deviation from v1, which writes `-0.00`), and `null` for anything that is not a plain
 * decimal (`nan`, `inf`, the exponent form used for |x| >= 1e21).
 */
function numberText(value: number, decimals: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) return null;
  let num = formatFixed(value, decimals);
  if (/^-0(\.0+)?$/.test(num)) num = num.slice(1);
  return PLAIN_NUM.test(num) ? num : null;
}

/**
 * v1 `format_value_like_baseline`: the old cell with its number replaced by `value`, keeping its
 * decimals (else `fallbackDecimals`), its `%` and its verbatim prefix / suffix. `null` when the
 * value or the resulting number text is not writable.
 */
export function formatLikeBaseline(
  oldCell: string,
  value: number,
  fallbackDecimals: number,
): string | null {
  const s = String(oldCell);
  const m = NUM_RE.exec(s);
  // v1 `_infer_decimals_from_baseline_cell`: everything after the first '.' of the match.
  const dec = m === null ? fallbackDecimals : m[0].includes('.') ? m[0].split('.')[1].length : 0;
  const num = numberText(value, dec);
  if (num === null) return null;
  const wantsPercent = s.includes('%');
  const withPercent = wantsPercent ? `${num}%` : num;
  let out: string;
  if (m === null) {
    out = withPercent;
  } else {
    const prefix = s.slice(0, m.index);
    const suffix = s.slice(m.index + m[0].length);
    out =
      wantsPercent && (prefix + suffix).includes('%')
        ? `${prefix}${num}${suffix}`
        : `${prefix}${withPercent}${suffix}`;
  }
  if (PLAIN_CELL.test(s) && !PLAIN_CELL.test(out)) return null;
  return out;
}

/** `keepFormatting: false`: the metric's decimals, plus `%` when the old cell had one. */
export function formatPlain(oldCell: string, value: number, decimals: number): string | null {
  const num = numberText(value, decimals);
  if (num === null) return null;
  return num + (String(oldCell).includes('%') ? '%' : '');
}

/** v1 `_decimals_from_round_transform`, else 2. */
function fallbackDecimals(transforms: Transform[]): number {
  const r = transforms.find((t) => t.kind === 'round');
  return r && r.kind === 'round' ? r.decimals : 2;
}

function baselineColumn(group: Group, key: string, metric: Metric, kind: SourceKind) {
  if (Object.hasOwn(group.column_overrides, key)) {
    const o = group.column_overrides[key];
    if (Object.hasOwn(o, kind) && typeof o[kind] === 'string') return o[kind] as string;
  }
  const spec = Object.hasOwn(metric.columns, kind) ? metric.columns[kind] : undefined;
  return spec?.column ?? null;
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

/**
 * The write-back plan of `run` into `baseline`: one table plan per baseline table read by a valid
 * group (in config order; groups sharing a table share its plan), entries in experiment order then
 * the group's metric order — the order v1 `--modify-in-place` prints within a file.
 */
export function planWriteback(
  comparison: Comparison,
  config: Config,
  baseline: Source,
  run: Source,
  options: WritebackOptions,
): WritebackPlan {
  const kind = baseline.kind;
  const byPath = new Map<string, WritebackTablePlan>();
  const seen = new Map<string, Set<string>>(); // path -> `${rowIndex}:${columnIndex}`
  const counted = new Map<string, Set<number>>(); // path -> baseline rows already counted

  for (const g of comparison.groups) {
    if (!g.valid) continue;
    const group = g.group;
    const table = groupTable(group, baseline);
    if (table === null) continue;
    let tp = byPath.get(table.path);
    if (!tp) {
      tp = { path: table.path, table, entries: [], experiments: 0, notInRun: [], unwritable: [] };
      byPath.set(table.path, tp);
      seen.set(table.path, new Set());
      counted.set(table.path, new Set());
    }
    const done = seen.get(table.path)!;
    const rowsCounted = counted.get(table.path)!;
    const { header, rows, records } = table.csv;

    const metrics = unique(group.metrics)
      .filter((k) => Object.hasOwn(config.metrics, k))
      .flatMap((key) => {
        const metric = config.metrics[key];
        const column = baselineColumn(group, key, metric, kind);
        const columnIndex = column === null ? -1 : header.indexOf(column);
        if (column === null || columnIndex < 0) return [];
        const writable = isWritableMetric(metric, kind);
        if (!writable && !tp.unwritable.includes(column)) tp.unwritable.push(column);
        const spec = metric.columns[kind];
        return [{ key, metric, column, columnIndex, writable, spec }];
      });

    for (const row of g.experiments) {
      const rowIndex = row.baseRow.chosen;
      if (rowIndex === null) continue;
      const cells = Object.hasOwn(row.cells, run.id) ? row.cells[run.id] : undefined;
      const anyCell = cells ? Object.values(cells)[0] : undefined;
      if (!rowsCounted.has(rowIndex)) {
        rowsCounted.add(rowIndex);
        tp.experiments++;
        // Whether the run has the experiment does not depend on the metric (one row match per run).
        if (anyCell !== undefined && anyCell.match.chosen === null) tp.notInRun.push(row.name);
      }
      if (!cells) continue;
      const fields = records[rowIndex + 1].fields;
      for (const m of metrics) {
        if (!Object.hasOwn(cells, m.key)) continue;
        const cell = cells[m.key];
        if (cell.match.chosen === null) continue; // experiment not in the run: no entry (as v1)
        if (m.columnIndex >= fields.length) continue; // short record: the field does not exist
        const id = `${rowIndex}:${m.columnIndex}`;
        if (done.has(id)) continue;
        const old = rows[rowIndex][m.columnIndex] ?? '';
        const base = {
          rowIndex,
          columnIndex: m.columnIndex,
          column: m.column,
          old,
          experiment: row.name,
          metric: m.key,
        };
        const push = (entry: WritebackEntry) => {
          done.add(id);
          tp.entries.push(entry);
        };
        if (!m.writable) {
          push({ ...base, new: old, skipped: 'transform' });
          continue;
        }
        const value = cell.value;
        if (!(typeof value === 'number' && Number.isFinite(value))) {
          push({ ...base, new: old, skipped: 'non-numeric' });
          continue;
        }
        const text = options.keepFormatting
          ? formatLikeBaseline(old, value, fallbackDecimals(m.spec?.transforms ?? []))
          : formatPlain(old, value, m.metric.decimals);
        if (text === null) {
          push({ ...base, new: old, skipped: 'non-numeric' });
          continue;
        }
        if (text === old) continue; // not a change (v1: str(old) != str(new))
        let skipped: WritebackSkip | undefined;
        if (options.skipEpisodeMismatch && row.episodesMismatch[run.id]) skipped = 'episodes';
        else if (options.skipWithinTol && cell.verdict === 'same') skipped = 'tolerance';
        else if (options.kept.has(keptKey(run.id, table.path, row.name, m.column)))
          skipped = 'kept';
        push(skipped ? { ...base, new: text, skipped } : { ...base, new: text });
      }
    }
  }
  return { runId: run.id, tables: [...byPath.values()] };
}

/** The non-skipped entries of a table plan as `rewriteRows` changes. */
export function tableChanges(tp: WritebackTablePlan) {
  return tp.entries
    .filter((e) => e.skipped === undefined)
    .map((e) => ({ rowIndex: e.rowIndex, columnIndex: e.columnIndex, value: e.new }));
}

/** Count of entries per skip reason (reasons with 0 omitted), in a fixed order. */
export function skipCounts(entries: WritebackEntry[]): [WritebackSkip, number][] {
  const order: WritebackSkip[] = ['kept', 'tolerance', 'episodes', 'non-numeric', 'transform'];
  return order
    .map((r): [WritebackSkip, number] => [r, entries.filter((e) => e.skipped === r).length])
    .filter(([, n]) => n > 0);
}
