import { compileMatchRegex, compileUserRegex } from '../compare/safeRegex';
import { emptyConfig } from '../model/types';
import type {
  ChartDef,
  ColumnSpec,
  Config,
  ConfigIssue,
  Direction,
  Group,
  IssueCode,
  MatchMode,
  Metric,
  SourceKind,
  Transform,
  Verdict,
} from '../model/types';

/**
 * The structural boundary of the app (spec Phase 2b "Config structural rules"). Every config that
 * enters the app — imported YAML/JSON, a v1 import, a value restored from localStorage — goes
 * through `validateConfig`, which never throws and always returns a structurally safe `Config`:
 * every field present, of its declared type and within bounds, built from fresh object literals by
 * explicit property picks (never a spread/assign/clone of raw input, so an own `__proto__` key in
 * the input can never reach a prototype). Unknown keys are reported and dropped.
 */

export const METRIC_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const CHART_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
export const LIMITS = {
  metrics: 200,
  groups: 100,
  experimentsPerGroup: 5000,
  charts: 100,
  stringLength: 512,
  decimalsMax: 10,
} as const;

export function isValidMetricKey(key: string): boolean {
  return METRIC_KEY_RE.test(key) && !RESERVED_KEYS.has(key);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const SOURCE_KINDS: readonly SourceKind[] = ['repo', 'wandb'];
export const DIRECTIONS: readonly Direction[] = ['higher', 'lower', 'match'];
export const CHART_TYPES: readonly ChartDef['type'][] = [
  'grouped_bars',
  'delta_dots',
  'small_multiples',
  'trend',
];
const VERDICT_KEYS: readonly Verdict[] = ['same', 'better', 'worse', 'mismatch', 'missing'];
const SIMPLE_TRANSFORMS = [
  'lowercase',
  'uppercase',
  'trim',
  'to_number',
  'rad_to_deg',
  'deg_to_rad',
  'sec_to_min',
  'min_to_sec',
  'frac_to_percent',
  'percent_to_frac',
] as const;
/** The 16 transform kinds (v1 set), in the order the editor's "+ transform" menu lists them. */
export const TRANSFORM_KINDS: readonly Transform['kind'][] = [
  ...SIMPLE_TRANSFORMS,
  'strip_prefix',
  'strip_suffix',
  'regex_replace',
  'round',
  'scale',
  'clip',
];

const has = (o: Record<string, unknown>, k: string): boolean => Object.hasOwn(o, k);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

type Target = ConfigIssue['target'];

/** Issue collector plus the small typed readers every rule shares. */
class Ctx {
  issues: ConfigIssue[] = [];

  add(code: IssueCode, severity: 'error' | 'warning', path: string, what: string, target?: Target) {
    const issue: ConfigIssue = { code, severity, message: `${path}: ${what}` };
    if (target) issue.target = target;
    this.issues.push(issue);
  }

  /** Wrong type / out of bound: error, the caller substitutes the default. */
  range(path: string, what: string, target?: Target) {
    this.add('value-out-of-range', 'error', path, what, target);
  }

  /** A string capped at LIMITS.stringLength (warning when truncated). */
  str(v: string, path: string, target?: Target): string {
    if (v.length <= LIMITS.stringLength) return v;
    this.add(
      'value-out-of-range',
      'warning',
      path,
      `longer than ${LIMITS.stringLength} characters, truncated`,
      target,
    );
    return v.slice(0, LIMITS.stringLength);
  }

  /** Report every own key of `raw` that is not allowed (reserved names as `key-reserved`). */
  unknownKeys(
    raw: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
    silent: readonly string[] = [],
    target?: Target,
  ) {
    for (const k of Object.keys(raw)) {
      if (allowed.includes(k) || silent.includes(k)) continue;
      if (RESERVED_KEYS.has(k)) this.add('key-reserved', 'error', `${path}.${k}`, 'reserved key');
      else this.add('unknown-key', 'warning', `${path}.${k}`, 'unknown key', target);
    }
  }
}

function parseMatch(raw: unknown, path: string, ctx: Ctx, target?: Target): MatchMode | null {
  if (raw === 'exact' || raw === 'suffix') return raw;
  if (isPlainObject(raw) && has(raw, 'regex') && typeof raw.regex === 'string') {
    ctx.unknownKeys(raw, ['regex'], path, [], target);
    return { regex: ctx.str(raw.regex, `${path}.regex`, target) };
  }
  ctx.range(path, 'must be "exact", "suffix" or { regex: <pattern> }', target);
  return null;
}

function parseTransform(raw: unknown, path: string, ctx: Ctx, target: Target): Transform | null {
  let kind: unknown;
  let o: Record<string, unknown> = {};
  if (typeof raw === 'string') kind = raw;
  else if (isPlainObject(raw)) {
    o = raw;
    kind = has(raw, 'kind') ? raw.kind : undefined;
  } else {
    ctx.add('transform-unknown', 'error', path, 'a transform must be a kind or a mapping', target);
    return null;
  }
  if (typeof kind !== 'string' || !(TRANSFORM_KINDS as readonly string[]).includes(kind)) {
    ctx.add('transform-unknown', 'error', path, `unknown transform "${String(kind)}"`, target);
    return null;
  }
  const bad = (param: string, what: string): null => {
    ctx.add('transform-unknown', 'error', `${path}.${param}`, what, target);
    return null;
  };

  switch (kind) {
    case 'strip_prefix':
    case 'strip_suffix': {
      const alias = kind === 'strip_prefix' ? 'prefix' : 'suffix';
      ctx.unknownKeys(o, ['kind', 'value', alias], path, [], target);
      const src = has(o, 'value') ? 'value' : has(o, alias) ? alias : null;
      let value = '';
      if (src !== null) {
        if (typeof o[src] !== 'string') return bad(src, 'must be a string');
        value = ctx.str(o[src] as string, `${path}.${src}`, target);
      }
      return { kind, value };
    }
    case 'regex_replace': {
      ctx.unknownKeys(o, ['kind', 'pattern', 'replacement', 'repl'], path, [], target);
      if (!has(o, 'pattern')) return bad('pattern', 'missing pattern');
      if (typeof o.pattern !== 'string') return bad('pattern', 'must be a string');
      const src = has(o, 'replacement') ? 'replacement' : has(o, 'repl') ? 'repl' : null;
      let replacement = '';
      if (src !== null) {
        if (typeof o[src] !== 'string') return bad(src, 'must be a string');
        replacement = ctx.str(o[src] as string, `${path}.${src}`, target);
      }
      return { kind, pattern: ctx.str(o.pattern, `${path}.pattern`, target), replacement };
    }
    case 'round': {
      ctx.unknownKeys(o, ['kind', 'decimals'], path, [], target);
      if (!has(o, 'decimals')) return { kind, decimals: 0 };
      const d = o.decimals;
      if (!isFiniteNumber(d)) return bad('decimals', 'must be a finite number');
      if (!Number.isInteger(d) || d < 0 || d > LIMITS.decimalsMax) {
        const clamped = Math.min(LIMITS.decimalsMax, Math.max(0, Math.round(d)));
        ctx.range(`${path}.decimals`, `must be an integer 0–10, clamped to ${clamped}`, target);
        return { kind, decimals: clamped };
      }
      return { kind, decimals: d };
    }
    case 'scale': {
      ctx.unknownKeys(o, ['kind', 'factor'], path, [], target);
      if (!has(o, 'factor')) return { kind, factor: 1 };
      if (!isFiniteNumber(o.factor)) return bad('factor', 'must be a finite number');
      return { kind, factor: o.factor };
    }
    case 'clip': {
      ctx.unknownKeys(o, ['kind', 'min', 'max'], path, [], target);
      const t: Transform = { kind: 'clip' };
      for (const p of ['min', 'max'] as const) {
        if (!has(o, p)) continue;
        if (!isFiniteNumber(o[p])) return bad(p, 'must be a finite number');
        t[p] = o[p] as number;
      }
      return t;
    }
    default:
      ctx.unknownKeys(o, ['kind'], path, [], target);
      return { kind: kind as (typeof SIMPLE_TRANSFORMS)[number] };
  }
}

function parseTransforms(raw: unknown, path: string, ctx: Ctx, target: Target): Transform[] {
  if (raw === undefined) return [];
  // v1 `_normalize_transforms`: a single transform (string or mapping) is a one-element list.
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' || isPlainObject(raw)
      ? [raw]
      : null;
  if (list === null) {
    ctx.range(path, 'must be a list of transforms', target);
    return [];
  }
  const out: Transform[] = [];
  list.forEach((item, i) => {
    const t = parseTransform(item, `${path}[${i}]`, ctx, target);
    if (t) out.push(t);
  });
  return out;
}

function parseColumnSpec(raw: unknown, path: string, ctx: Ctx, target: Target): ColumnSpec | null {
  if (!isPlainObject(raw) || !has(raw, 'column') || typeof raw.column !== 'string') {
    ctx.range(path, 'a column spec needs a string "column"; dropped', target);
    return null;
  }
  ctx.unknownKeys(raw, ['column', 'transforms'], path, [], target);
  return {
    column: ctx.str(raw.column, `${path}.column`, target),
    transforms: parseTransforms(
      has(raw, 'transforms') ? raw.transforms : undefined,
      `${path}.transforms`,
      ctx,
      target,
    ),
  };
}

function parseMetric(key: string, raw: unknown, path: string, ctx: Ctx): Metric | null {
  const target: Target = { kind: 'metric', id: key };
  if (!isPlainObject(raw)) {
    ctx.range(path, 'a metric must be a mapping; dropped', target);
    return null;
  }
  ctx.unknownKeys(
    raw,
    ['label', 'units', 'direction', 'tolerance', 'tolerance_mode', 'decimals', 'columns'],
    path,
    [],
    target,
  );

  let label = key;
  if (has(raw, 'label')) {
    if (typeof raw.label === 'string') label = ctx.str(raw.label, `${path}.label`, target);
    else ctx.range(`${path}.label`, 'must be a string', target);
  }
  let units: string | undefined;
  if (has(raw, 'units')) {
    if (typeof raw.units === 'string') units = ctx.str(raw.units, `${path}.units`, target);
    else ctx.range(`${path}.units`, 'must be a string; omitted', target);
  }
  let direction: Direction = 'lower';
  if (has(raw, 'direction')) {
    if ((DIRECTIONS as readonly unknown[]).includes(raw.direction))
      direction = raw.direction as Direction;
    else ctx.range(`${path}.direction`, 'must be higher, lower or match', target);
  }
  let tolerance = 0;
  if (has(raw, 'tolerance')) {
    if (isFiniteNumber(raw.tolerance) && raw.tolerance >= 0) tolerance = raw.tolerance;
    else ctx.range(`${path}.tolerance`, 'must be a finite number ≥ 0', target);
  }
  let toleranceMode: Metric['tolerance_mode'] = 'absolute';
  if (has(raw, 'tolerance_mode')) {
    if (raw.tolerance_mode === 'absolute' || raw.tolerance_mode === 'percent')
      toleranceMode = raw.tolerance_mode;
    else ctx.range(`${path}.tolerance_mode`, 'must be absolute or percent', target);
  }
  let decimals = 2;
  if (has(raw, 'decimals')) {
    const d = raw.decimals;
    if (isFiniteNumber(d) && Number.isInteger(d) && d >= 0 && d <= LIMITS.decimalsMax) decimals = d;
    else ctx.range(`${path}.decimals`, 'must be an integer 0–10', target);
  }
  const columns: Metric['columns'] = {};
  if (has(raw, 'columns')) {
    const c = raw.columns;
    if (isPlainObject(c)) {
      ctx.unknownKeys(c, SOURCE_KINDS, `${path}.columns`, [], target);
      for (const kind of SOURCE_KINDS) {
        if (!has(c, kind)) continue;
        const spec = parseColumnSpec(c[kind], `${path}.columns.${kind}`, ctx, target);
        if (spec) columns[kind] = spec;
      }
    } else ctx.range(`${path}.columns`, 'must be a mapping', target);
  }

  // Fields in the documented order (label, units, direction, …) so YAML export reads naturally.
  return units === undefined
    ? { label, direction, tolerance, tolerance_mode: toleranceMode, decimals, columns }
    : { label, units, direction, tolerance, tolerance_mode: toleranceMode, decimals, columns };
}

function parseMetrics(raw: unknown, ctx: Ctx): Record<string, Metric> {
  const out: Record<string, Metric> = {};
  if (raw === undefined) return out;
  if (!isPlainObject(raw)) {
    ctx.range('metrics', 'must be a mapping');
    return out;
  }
  let count = 0;
  let capped = false;
  for (const key of Object.keys(raw)) {
    if (RESERVED_KEYS.has(key)) {
      ctx.add('key-reserved', 'error', `metrics.${key}`, 'reserved key; dropped');
      continue;
    }
    if (!METRIC_KEY_RE.test(key)) {
      ctx.add(
        'key-reserved',
        'error',
        `metrics.${key}`,
        'metric keys must match ^[a-z][a-z0-9_]{0,63}$; dropped',
      );
      continue;
    }
    if (count >= LIMITS.metrics) {
      capped = true;
      continue;
    }
    const m = parseMetric(key, raw[key], `metrics.${key}`, ctx);
    if (m) {
      out[key] = m;
      count++;
    }
  }
  if (capped) ctx.range('metrics', `more than ${LIMITS.metrics} metrics; the rest were dropped`);
  return out;
}

function parseStringList(
  raw: unknown,
  path: string,
  ctx: Ctx,
  target: Target,
  each: (s: string, p: string) => string | null,
  cap?: number,
): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    ctx.range(path, 'must be a list of strings', target);
    return [];
  }
  const out: string[] = [];
  let capped = false;
  raw.forEach((v, i) => {
    const p = `${path}[${i}]`;
    if (typeof v !== 'string') {
      ctx.range(p, 'must be a string; dropped', target);
      return;
    }
    const s = each(v, p);
    if (s === null) return;
    if (cap !== undefined && out.length >= cap) {
      capped = true;
      return;
    }
    out.push(s);
  });
  if (capped) ctx.range(path, `more than ${cap} entries; the rest were dropped`, target);
  return out;
}

function parseOverrides(
  raw: unknown,
  path: string,
  ctx: Ctx,
  target: Target,
): Group['column_overrides'] {
  const out: Group['column_overrides'] = {};
  if (raw === undefined) return out;
  if (!isPlainObject(raw)) {
    ctx.range(path, 'must be a mapping', target);
    return out;
  }
  for (const key of Object.keys(raw)) {
    const p = `${path}.${key}`;
    if (RESERVED_KEYS.has(key) || !METRIC_KEY_RE.test(key)) {
      ctx.add('key-reserved', 'error', p, 'not a valid metric key; dropped', target);
      continue;
    }
    const inner = raw[key];
    if (!isPlainObject(inner)) {
      ctx.range(p, 'must be a mapping of source kind to column; dropped', target);
      continue;
    }
    ctx.unknownKeys(inner, SOURCE_KINDS, p, [], target);
    const o: Partial<Record<SourceKind, string>> = {};
    for (const kind of SOURCE_KINDS) {
      if (!has(inner, kind)) continue;
      const v = inner[kind];
      if (typeof v === 'string') o[kind] = ctx.str(v, `${p}.${kind}`, target);
      else ctx.range(`${p}.${kind}`, 'must be a string; dropped', target);
    }
    out[key] = o;
  }
  return out;
}

function parseGroup(raw: unknown, path: string, ctx: Ctx): Group | null {
  if (!isPlainObject(raw)) {
    ctx.range(path, 'a group must be a mapping; dropped');
    return null;
  }
  if (!has(raw, 'name') || typeof raw.name !== 'string' || raw.name.trim() === '') {
    ctx.range(`${path}.name`, 'a group needs a non-empty string name; dropped');
    return null;
  }
  const name = ctx.str(raw.name, `${path}.name`);
  const target: Target = { kind: 'group', id: name };
  ctx.unknownKeys(
    raw,
    ['name', 'table', 'match', 'metrics', 'column_overrides', 'experiments'],
    path,
    [],
    target,
  );
  let table: string | null = null;
  if (has(raw, 'table') && raw.table !== null) {
    if (typeof raw.table === 'string') table = ctx.str(raw.table, `${path}.table`, target);
    else ctx.range(`${path}.table`, 'must be a string or null', target);
  }
  const match = has(raw, 'match') ? parseMatch(raw.match, `${path}.match`, ctx, target) : null;
  const metrics = parseStringList(
    has(raw, 'metrics') ? raw.metrics : undefined,
    `${path}.metrics`,
    ctx,
    target,
    // Reserved names are dropped; any other string is kept even when it is not a metric key
    // (e.g. `toString`): `configIssues` reports it as `metric-unknown` and `compareAll` skips it
    // (spec Phase 2b schema test; decision recorded in the phase notes).
    (s, p) => {
      if (RESERVED_KEYS.has(s)) {
        ctx.add('key-reserved', 'error', p, `"${s}" is a reserved name; dropped`, target);
        return null;
      }
      return ctx.str(s, p, target);
    },
  );
  const columnOverrides = parseOverrides(
    has(raw, 'column_overrides') ? raw.column_overrides : undefined,
    `${path}.column_overrides`,
    ctx,
    target,
  );
  const experiments = parseStringList(
    has(raw, 'experiments') ? raw.experiments : undefined,
    `${path}.experiments`,
    ctx,
    target,
    (s, p) => ctx.str(s, p, target),
    LIMITS.experimentsPerGroup,
  );
  const group: Group =
    match === null
      ? { name, table, metrics, column_overrides: columnOverrides, experiments }
      : { name, table, match, metrics, column_overrides: columnOverrides, experiments };
  return group;
}

function parseGroups(raw: unknown, ctx: Ctx): Group[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    ctx.range('groups', 'must be a list');
    return [];
  }
  const out: Group[] = [];
  let capped = false;
  raw.forEach((g, i) => {
    const group = parseGroup(g, `groups[${i}]`, ctx);
    if (!group) return;
    if (out.length >= LIMITS.groups) capped = true;
    else out.push(group);
  });
  if (capped) ctx.range('groups', `more than ${LIMITS.groups} groups; the rest were dropped`);
  return out;
}

/** A parsed chart whose id is not yet checked (ids are assigned once all charts are known). */
type DraftChart = { rawId: unknown; chart: Omit<ChartDef, 'id'> };

function parseChart(raw: unknown, path: string, ctx: Ctx): DraftChart | null {
  if (!isPlainObject(raw)) {
    ctx.range(path, 'a chart must be a mapping; dropped');
    return null;
  }
  const rawId = has(raw, 'id') ? raw.id : undefined;
  const target: Target | undefined =
    typeof rawId === 'string' ? { kind: 'chart', id: rawId } : undefined;
  ctx.unknownKeys(
    raw,
    ['id', 'type', 'metric', 'group', 'experiments', 'title', 'options'],
    path,
    [],
    target,
  );
  if (!(CHART_TYPES as readonly unknown[]).includes(raw.type)) {
    ctx.range(`${path}.type`, `must be one of ${CHART_TYPES.join(', ')}; chart dropped`, target);
    return null;
  }
  if (!has(raw, 'metric') || typeof raw.metric !== 'string') {
    ctx.range(`${path}.metric`, 'must be a string; chart dropped', target);
    return null;
  }
  if (!has(raw, 'group') || typeof raw.group !== 'string') {
    ctx.range(`${path}.group`, 'must be a string; chart dropped', target);
    return null;
  }
  let experiments: string[] | null = null;
  if (has(raw, 'experiments') && raw.experiments !== null) {
    if (Array.isArray(raw.experiments)) {
      experiments = parseStringList(
        raw.experiments,
        `${path}.experiments`,
        ctx,
        target,
        (s, p) => ctx.str(s, p, target),
        LIMITS.experimentsPerGroup,
      );
    } else ctx.range(`${path}.experiments`, 'must be a list of strings or null', target);
  }
  let title: string | undefined;
  if (has(raw, 'title')) {
    if (typeof raw.title === 'string') title = ctx.str(raw.title, `${path}.title`, target);
    else ctx.range(`${path}.title`, 'must be a string; omitted', target);
  }
  const options = { toleranceBand: true, deltaLabels: true, yFromZero: true };
  if (has(raw, 'options')) {
    const o = raw.options;
    if (isPlainObject(o)) {
      ctx.unknownKeys(o, Object.keys(options), `${path}.options`, [], target);
      for (const k of ['toleranceBand', 'deltaLabels', 'yFromZero'] as const) {
        if (!has(o, k)) continue;
        if (typeof o[k] === 'boolean') options[k] = o[k] as boolean;
        else ctx.range(`${path}.options.${k}`, 'must be a boolean', target);
      }
    } else ctx.range(`${path}.options`, 'must be a mapping', target);
  }
  const base = {
    type: raw.type as ChartDef['type'],
    metric: ctx.str(raw.metric, `${path}.metric`, target),
    group: ctx.str(raw.group, `${path}.group`, target),
    experiments,
  };
  const chart: Omit<ChartDef, 'id'> =
    title === undefined ? { ...base, options } : { ...base, title, options };
  return { rawId, chart };
}

function parseCharts(raw: unknown, ctx: Ctx): ChartDef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    ctx.range('charts', 'must be a list');
    return [];
  }
  const drafts: DraftChart[] = [];
  let capped = false;
  raw.forEach((c, i) => {
    const d = parseChart(c, `charts[${i}]`, ctx);
    if (!d) return;
    if (drafts.length >= LIMITS.charts) capped = true;
    else drafts.push(d);
  });
  if (capped) ctx.range('charts', `more than ${LIMITS.charts} charts; the rest were dropped`);

  // Valid, unique ids are kept (first occurrence wins); every other chart gets the smallest free
  // `c<n>`, so a regenerated id never collides with a kept one.
  const ok = drafts.map(({ rawId }, i) => {
    if (typeof rawId !== 'string' || !CHART_ID_RE.test(rawId)) return false;
    return drafts.findIndex((d) => d.rawId === rawId) === i;
  });
  const used = new Set<string>();
  drafts.forEach((d, i) => {
    if (ok[i]) used.add(d.rawId as string);
  });
  return drafts.map((d, i) => {
    let id: string;
    if (ok[i]) id = d.rawId as string;
    else {
      let n = 1;
      while (used.has(`c${n}`)) n++;
      id = `c${n}`;
      used.add(id);
      ctx.add(
        'value-out-of-range',
        'warning',
        `charts[${i}].id`,
        `missing, invalid or duplicate chart id; regenerated as "${id}"`,
        { kind: 'chart', id },
      );
    }
    const c = d.chart;
    return c.title === undefined
      ? {
          id,
          type: c.type,
          metric: c.metric,
          group: c.group,
          experiments: c.experiments,
          options: c.options,
        }
      : {
          id,
          type: c.type,
          metric: c.metric,
          group: c.group,
          experiments: c.experiments,
          title: c.title,
          options: c.options,
        };
  });
}

function parseSources(raw: unknown, ctx: Ctx): Config['sources'] {
  const out = emptyConfig().sources;
  if (raw === undefined) return out;
  if (!isPlainObject(raw)) {
    ctx.range('sources', 'must be a mapping');
    return out;
  }
  ctx.unknownKeys(raw, SOURCE_KINDS, 'sources');
  for (const kind of SOURCE_KINDS) {
    if (!has(raw, kind)) continue;
    const s = raw[kind];
    const path = `sources.${kind}`;
    if (!isPlainObject(s)) {
      ctx.range(path, 'must be a mapping');
      continue;
    }
    ctx.unknownKeys(s, ['id_column', 'match'], path);
    if (has(s, 'id_column')) {
      if (typeof s.id_column === 'string')
        out[kind].id_column = ctx.str(s.id_column, `${path}.id_column`);
      else ctx.range(`${path}.id_column`, 'must be a string');
    }
    if (has(s, 'match')) {
      const m = parseMatch(s.match, `${path}.match`, ctx);
      if (m !== null) out[kind].match = m;
    }
  }
  return out;
}

function parseOutput(raw: unknown, ctx: Ctx): Config['output'] {
  const out = emptyConfig().output;
  if (raw === undefined) return out;
  if (!isPlainObject(raw)) {
    ctx.range('output', 'must be a mapping');
    return out;
  }
  ctx.unknownKeys(raw, ['markdown'], 'output');
  if (!has(raw, 'markdown')) return out;
  const m = raw.markdown;
  const path = 'output.markdown';
  if (!isPlainObject(m)) {
    ctx.range(path, 'must be a mapping');
    return out;
  }
  const md = out.markdown;
  ctx.unknownKeys(
    m,
    ['float_precision', 'include_units_in_headers', 'show_deltas', 'show_pass_fail', 'symbols'],
    path,
  );
  if (has(m, 'float_precision')) {
    const d = m.float_precision;
    if (isFiniteNumber(d) && Number.isInteger(d) && d >= 0 && d <= LIMITS.decimalsMax)
      md.float_precision = d;
    else ctx.range(`${path}.float_precision`, 'must be an integer 0–10');
  }
  for (const k of ['include_units_in_headers', 'show_deltas', 'show_pass_fail'] as const) {
    if (!has(m, k)) continue;
    if (typeof m[k] === 'boolean') md[k] = m[k] as boolean;
    else ctx.range(`${path}.${k}`, 'must be a boolean');
  }
  if (has(m, 'symbols')) {
    const s = m.symbols;
    if (isPlainObject(s)) {
      ctx.unknownKeys(s, VERDICT_KEYS, `${path}.symbols`);
      for (const v of VERDICT_KEYS) {
        if (!has(s, v)) continue;
        if (typeof s[v] === 'string')
          md.symbols[v] = ctx.str(s[v] as string, `${path}.symbols.${v}`);
        else ctx.range(`${path}.symbols.${v}`, 'must be a string');
      }
    } else ctx.range(`${path}.symbols`, 'must be a mapping');
  }
  return out;
}

/**
 * `regex-invalid` issues for every user pattern of a (structurally valid) config. Shared by
 * `validateConfig` and `configIssues`, so an invalid pattern kept in the config is always reported.
 */
export function regexIssues(config: Config): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const msg = (pattern: string, error: string) => `Invalid regex "${pattern}": ${error}`;
  for (const g of config.groups) {
    if (g.match === undefined || typeof g.match === 'string') continue;
    const r = compileMatchRegex(g.match.regex, 'x');
    if ('error' in r) {
      issues.push({
        code: 'regex-invalid',
        severity: 'error',
        message: msg(g.match.regex, r.error),
        target: { kind: 'group', id: g.name },
      });
    }
  }
  for (const kind of SOURCE_KINDS) {
    const m = config.sources[kind].match;
    if (typeof m === 'string') continue;
    const r = compileMatchRegex(m.regex, 'x');
    if (!('error' in r)) continue;
    const affected = config.groups.filter((g) => g.match === undefined);
    const ids = affected.length > 0 ? affected.map((g) => g.name) : [''];
    for (const id of ids) {
      issues.push({
        code: 'regex-invalid',
        severity: 'error',
        message: msg(m.regex, r.error),
        target: { kind: 'group', id },
      });
    }
  }
  for (const key of Object.keys(config.metrics)) {
    const metric = config.metrics[key];
    for (const kind of SOURCE_KINDS) {
      const spec = Object.hasOwn(metric.columns, kind) ? metric.columns[kind] : undefined;
      if (!spec) continue;
      for (const t of spec.transforms) {
        if (t.kind !== 'regex_replace') continue;
        const r = compileUserRegex(t.pattern, 'g');
        if ('error' in r) {
          issues.push({
            code: 'regex-invalid',
            severity: 'error',
            message: msg(t.pattern, r.error),
            target: { kind: 'metric', id: key },
          });
        }
      }
    }
  }
  return issues;
}

/** `chart-metric-unknown` / `chart-group-unknown` warnings (one per chart and code). */
export function chartRefIssues(config: Config): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const chart of config.charts) {
    if (!Object.hasOwn(config.metrics, chart.metric)) {
      issues.push({
        code: 'chart-metric-unknown',
        severity: 'warning',
        message: `charts.${chart.id}: unknown metric "${chart.metric}"`,
        target: { kind: 'chart', id: chart.id },
      });
    }
    if (!config.groups.some((g) => g.name === chart.group)) {
      issues.push({
        code: 'chart-group-unknown',
        severity: 'warning',
        message: `charts.${chart.id}: unknown group "${chart.group}"`,
        target: { kind: 'chart', id: chart.id },
      });
    }
  }
  return issues;
}

/**
 * Validate and normalise any raw value into a `Config`. Never throws. Missing fields that have a
 * default are filled silently; wrong types and out-of-range values are errors and fall back to
 * the default; unknown keys are warnings and dropped. `validateConfig(validateConfig(x).config)`
 * is deep-equal to the first result and reports only `regex-invalid` / `chart-*-unknown`.
 */
export function validateConfig(raw: unknown): { config: Config; issues: ConfigIssue[] } {
  const ctx = new Ctx();
  if (!isPlainObject(raw)) {
    ctx.range('config', 'must be a mapping');
    return { config: emptyConfig(), issues: ctx.issues };
  }
  ctx.unknownKeys(
    raw,
    ['version', 'name', 'description', 'sources', 'metrics', 'groups', 'charts', 'output'],
    'config',
  );
  if (!has(raw, 'version')) ctx.range('version', 'missing; must be 2');
  else if (raw.version !== 2)
    ctx.range('version', `must be 2 (got ${JSON.stringify(raw.version) ?? '?'})`);

  let name = 'untitled';
  if (has(raw, 'name')) {
    if (typeof raw.name === 'string') name = ctx.str(raw.name, 'name');
    else ctx.range('name', 'must be a string');
  }
  let description: string | undefined;
  if (has(raw, 'description')) {
    if (typeof raw.description === 'string') description = ctx.str(raw.description, 'description');
    else ctx.range('description', 'must be a string; omitted');
  }
  const sources = parseSources(has(raw, 'sources') ? raw.sources : undefined, ctx);
  const metrics = parseMetrics(has(raw, 'metrics') ? raw.metrics : undefined, ctx);
  const groups = parseGroups(has(raw, 'groups') ? raw.groups : undefined, ctx);
  const charts = parseCharts(has(raw, 'charts') ? raw.charts : undefined, ctx);
  const output = parseOutput(has(raw, 'output') ? raw.output : undefined, ctx);

  const config: Config =
    description === undefined
      ? { version: 2, name, sources, metrics, groups, charts, output }
      : { version: 2, name, description, sources, metrics, groups, charts, output };
  return { config, issues: [...ctx.issues, ...regexIssues(config), ...chartRefIssues(config)] };
}
