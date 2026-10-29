import { groupTable } from '../../compare/compare';
import { isValidMetricKey, LIMITS } from '../../config/schema';
import { applyTransforms, type CellValue } from '../../model/transforms';
import type {
  ColumnSpec,
  Config,
  Group,
  Metric,
  Source,
  SourceKind,
  Transform,
} from '../../model/types';
import type { EditResult } from './model';

/*
 * Pure logic of the metric editor (spec Phase 4b): draft validation per the "Editor input rule"
 * (Phase 4a), metric / column / transform / override edits, the sample line and the overrides
 * list. Every edit returns a new Config with the metrics map rebuilt in order (a validated key is
 * the only property name ever written).
 */

// ---- Draft validation (null = valid) ----

export function metricKeyError(config: Config, current: string, draft: string): string | null {
  if (draft === current) return null;
  if (!isValidMetricKey(draft)) {
    return 'Lower-case letters, digits and _ only, starting with a letter (≤ 64)';
  }
  if (Object.hasOwn(config.metrics, draft)) return `“${draft}” is already a metric key`;
  return null;
}

export function textError(draft: string, { required = false } = {}): string | null {
  if (required && draft.trim() === '') return 'Required';
  if (draft.length > LIMITS.stringLength) return `At most ${LIMITS.stringLength} characters`;
  return null;
}

/** Decimals / round.decimals: an integer 0–10. */
export function decimalsError(draft: string): string | null {
  const t = draft.trim();
  if (!/^\d+$/.test(t)) return 'A whole number from 0 to 10';
  const n = Number(t);
  return n <= LIMITS.decimalsMax ? null : 'A whole number from 0 to 10';
}

/** A finite number written in plain decimal or exponent notation. */
export function parseFinite(draft: string): number | null {
  const t = draft.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Tolerance: a finite number ≥ 0. */
export function toleranceError(draft: string): string | null {
  const n = parseFinite(draft);
  if (n === null) return 'A number ≥ 0';
  return n >= 0 ? null : 'A number ≥ 0';
}

/** `scale.factor`, `clip.min` / `clip.max`: finite; `optional` accepts '' (no bound). */
export function finiteError(draft: string, optional = false): string | null {
  if (optional && draft.trim() === '') return null;
  return parseFinite(draft) === null ? 'A finite number' : null;
}

// ---- Edits ----

/** Replace metric `key` by `mutate(metric)`, keeping the map order. */
export function updateMetric(config: Config, key: string, mutate: (m: Metric) => Metric): Config {
  if (!Object.hasOwn(config.metrics, key)) return config;
  const metrics: Record<string, Metric> = {};
  for (const k of Object.keys(config.metrics)) {
    metrics[k] = k === key ? mutate(config.metrics[k]) : config.metrics[k];
  }
  return { ...config, metrics };
}

/** Metric with `units` set, or removed when empty (keeps the documented field order). */
export function withUnits(m: Metric, units: string): Metric {
  const rest = {
    direction: m.direction,
    tolerance: m.tolerance,
    tolerance_mode: m.tolerance_mode,
    decimals: m.decimals,
    columns: m.columns,
  };
  return units === '' ? { label: m.label, ...rest } : { label: m.label, units, ...rest };
}

export function columnSpec(m: Metric, kind: SourceKind): ColumnSpec | undefined {
  return Object.hasOwn(m.columns, kind) ? m.columns[kind] : undefined;
}

/** Sets (or with `null` removes) the column spec of one kind. */
export function setColumnSpec(m: Metric, kind: SourceKind, spec: ColumnSpec | null): Metric {
  const columns: Metric['columns'] = {};
  for (const k of ['repo', 'wandb'] as const) {
    const s = k === kind ? spec : columnSpec(m, k);
    if (s) columns[k] = s;
  }
  return { ...m, columns };
}

/** Sets the column of one kind, keeping its transforms (new spec: `to_number`). */
export function setColumn(m: Metric, kind: SourceKind, column: string): Metric {
  const prev = columnSpec(m, kind);
  return setColumnSpec(m, kind, {
    column,
    transforms: prev ? prev.transforms : [{ kind: 'to_number' }],
  });
}

/** The transform a "+ transform" menu entry adds (defaults chosen to be no-ops where possible). */
export function defaultTransform(kind: Transform['kind'], m: Metric): Transform {
  switch (kind) {
    case 'strip_prefix':
    case 'strip_suffix':
      return { kind, value: '' };
    case 'regex_replace':
      return { kind, pattern: '', replacement: '' };
    case 'round':
      return { kind, decimals: m.decimals };
    case 'scale':
      return { kind, factor: 1 };
    case 'clip':
      return { kind, min: 0, max: 100 };
    default:
      return { kind };
  }
}

/** Transforms of one kind's spec replaced by `next(list)`; no-op when the kind has no spec. */
export function editTransforms(
  m: Metric,
  kind: SourceKind,
  next: (list: Transform[]) => Transform[],
): Metric {
  const spec = columnSpec(m, kind);
  if (!spec) return m;
  return setColumnSpec(m, kind, { column: spec.column, transforms: next(spec.transforms) });
}

/** `clip` with `min`/`max` from optional drafts ('' = no bound). */
export function clipTransform(min: string, max: string): Transform {
  const t: Transform = { kind: 'clip' };
  const lo = parseFinite(min);
  const hi = parseFinite(max);
  if (min.trim() !== '' && lo !== null) t.min = lo;
  if (max.trim() !== '' && hi !== null) t.max = hi;
  return t;
}

// ---- Group overrides ----

export interface OverrideRow {
  group: string;
  kind: SourceKind;
  column: string;
}

/** Every `column_overrides` entry of metric `key`, in group order then kind order. */
export function overridesOf(config: Config, key: string): OverrideRow[] {
  const out: OverrideRow[] = [];
  for (const g of config.groups) {
    if (!Object.hasOwn(g.column_overrides, key)) continue;
    const o = g.column_overrides[key];
    for (const kind of ['repo', 'wandb'] as const) {
      if (Object.hasOwn(o, kind) && typeof o[kind] === 'string') {
        out.push({ group: g.name, kind, column: o[kind] as string });
      }
    }
  }
  return out;
}

/** Sets (or with `null` removes) group `name`'s override of metric `key` for `kind`. */
export function setOverride(
  config: Config,
  name: string,
  key: string,
  kind: SourceKind,
  column: string | null,
): EditResult {
  if (!isValidMetricKey(key) || !Object.hasOwn(config.metrics, key)) {
    return { error: 'Unknown metric' };
  }
  const i = config.groups.findIndex((g) => g.name === name);
  if (i < 0) return { error: 'Unknown group' };
  if (column !== null) {
    const err = textError(column, { required: true });
    if (err !== null) return { error: err };
  }
  const g = config.groups[i];
  const prev = Object.hasOwn(g.column_overrides, key) ? g.column_overrides[key] : {};
  const entry: Partial<Record<SourceKind, string>> = {};
  for (const k of ['repo', 'wandb'] as const) {
    const v = k === kind ? column : Object.hasOwn(prev, k) ? prev[k] : undefined;
    if (typeof v === 'string') entry[k] = v;
  }
  const overrides: Group['column_overrides'] = {};
  let placed = false;
  for (const k of Object.keys(g.column_overrides)) {
    if (k === key) {
      placed = true;
      if (Object.keys(entry).length > 0) overrides[k] = entry;
    } else overrides[k] = g.column_overrides[k];
  }
  if (!placed && Object.keys(entry).length > 0) overrides[key] = entry;
  const groups = [...config.groups];
  groups[i] = { ...g, column_overrides: overrides };
  return { config: { ...config, groups } };
}

// ---- Usage, tolerance text, sample line ----

/** Groups listing metric `key` and charts drawing it (header and delete confirmation). */
export function metricUsage(config: Config, key: string): { groups: string[]; charts: string[] } {
  return {
    groups: config.groups.filter((g) => g.metrics.includes(key)).map((g) => g.name),
    charts: config.charts.filter((c) => c.metric === key).map((c) => c.title ?? c.id),
  };
}

/** The tolerance as the impact line's "was …" shows it (`0.01` or `1 %`). */
export function formatTolerance(m: Pick<Metric, 'tolerance' | 'tolerance_mode'>): string {
  return m.tolerance_mode === 'percent' ? `${m.tolerance} %` : String(m.tolerance);
}

export interface Sample {
  raw: string;
  value: CellValue;
  /** Label of the source the row came from. */
  source: string;
}

/**
 * The sample line of one column card: the first row (baseline first, then runs) of a source of
 * `kind` whose column for the metric has a non-empty value, run through the kind's transforms. A
 * repo source reads `group`'s table first (with its override), then its other tables.
 */
export function sampleOf(
  sources: readonly Source[],
  m: Metric,
  key: string,
  kind: SourceKind,
  group: Group | null,
): Sample | null {
  const spec = columnSpec(m, kind);
  if (!spec) return null;
  for (const source of sources) {
    if (source.kind !== kind) continue;
    const first = group ? groupTable(group, source) : null;
    const tables = first ? [first, ...source.tables.filter((t) => t !== first)] : source.tables;
    for (const table of tables) {
      let column = spec.column;
      if (table === first && group && Object.hasOwn(group.column_overrides, key)) {
        const o = group.column_overrides[key];
        if (Object.hasOwn(o, kind) && typeof o[kind] === 'string') column = o[kind] as string;
      }
      const c = table.csv.header.indexOf(column);
      if (c < 0) continue;
      for (const row of table.csv.rows) {
        const raw = row[c] ?? '';
        if (raw.trim() === '') continue;
        return { raw, value: applyTransforms(raw, spec.transforms), source: source.label };
      }
    }
  }
  return null;
}

/** Text of a transformed sample value: numbers as JS prints them, strings quoted, else missing. */
export function sampleText(value: CellValue): string {
  if (value === null || (typeof value === 'number' && Number.isNaN(value))) return 'missing';
  return typeof value === 'number' ? String(value) : `"${value}"`;
}

/** Splits a header into its name and a `|align right` / `|hidden` suffix (shown dimmed). */
export function splitHeaderSuffix(h: string): [string, string] {
  const m = /^(.*?)(\|(?:align right|hidden)\s*)$/.exec(h);
  return m ? [m[1], m[2]] : [h, ''];
}

/** Combobox filter: case-insensitive substring, at most `limit` entries. */
export function filterColumns(columns: readonly string[], query: string, limit = 200): string[] {
  const q = query.trim().toLowerCase();
  const out: string[] = [];
  for (const c of columns) {
    if (q === '' || c.toLowerCase().includes(q)) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
