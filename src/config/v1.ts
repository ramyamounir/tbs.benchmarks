import type { ConfigIssue, Config, SourceKind } from '../model/types';
import { isPlainObject, RESERVED_KEYS, validateConfig } from './schema';
import { parseYamlText } from './yamlParse';

/**
 * Import of a v1 `tbp.benchmarks` YAML config (spec Phase 2b "v1 import mapping"). The v1 format
 * names files, metrics and experiments separately; v2 groups experiments by table and folds the
 * `lm2_*` metric variants into per-group `column_overrides`. The importer only reads the v1 text;
 * it never looks at loaded sources (a table the baseline lacks is the normal `table-missing`).
 */

const has = (o: Record<string, unknown>, k: string): boolean => Object.hasOwn(o, k);
const obj = (v: unknown): Record<string, unknown> => (isPlainObject(v) ? v : {});
const strOr = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);

const KNOWN_LABELS: Record<string, string> = {
  percent_correct: 'Correct',
  used_mlh: 'Used MLH',
  match_steps: 'Match steps',
  rotation_error: 'Rotation error',
  runtime: 'Run time',
  episode_runtime: 'Episode time',
  num_episodes: 'Episodes',
  avg_prediction_error: 'Prediction error',
};

/** Label of a v2 metric key: known names mapped, else `_` → space with the first letter upper. */
export function v1Label(key: string): string {
  if (Object.hasOwn(KNOWN_LABELS, key)) return KNOWN_LABELS[key];
  const s = key.replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface V1File {
  kind: SourceKind;
  table: string | null; // `benchmarks/<x>.csv` for a repo table
}

/** `${BASELINE_PATH}/benchmarks/x.csv` → repo table; anything else (a bare export path) → wandb. */
function fileOf(raw: unknown): V1File {
  const path = strOr(obj(raw).path, '').replaceAll('\\', '/');
  const m = /(?:^|\/)benchmarks\/([^/]+\.csv)$/.exec(path);
  return m ? { kind: 'repo', table: `benchmarks/${m[1]}` } : { kind: 'wandb', table: null };
}

interface V1Side {
  column: string | null;
  transforms: unknown;
}

function sideOf(metric: Record<string, unknown>, side: 'baseline' | 'proposed'): V1Side {
  const s = obj(obj(metric.columns)[side]);
  return {
    column: typeof s.column === 'string' ? s.column : null,
    transforms: has(s, 'transforms') ? s.transforms : [],
  };
}

/** The `decimals` of the last `round` transform of a raw v1 transform list, else 2. */
function lastRoundDecimals(transforms: unknown): number {
  const list = Array.isArray(transforms) ? transforms : [transforms];
  let d = 2;
  for (const t of list) {
    if (isPlainObject(t) && t.kind === 'round') d = typeof t.decimals === 'number' ? t.decimals : 0;
    else if (t === 'round') d = 0;
  }
  return d;
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  taken.add(name);
  return name;
}

/**
 * The raw v2 document of a v1 config plus the importer's own notes. The result still goes through
 * `validateConfig` (transform aliases, bounds, key rules), so it is typed `unknown`-ish here.
 */
export function importV1Raw(raw: unknown): {
  value: Record<string, unknown>;
  issues: ConfigIssue[];
} {
  const issues: ConfigIssue[] = [];
  const doc = obj(raw);
  const files = obj(doc.files);
  const metricsRaw = obj(doc.metrics);
  const experimentsRaw = Array.isArray(doc.experiments) ? doc.experiments : [];

  const fileInfo = new Map<string, V1File>();
  for (const key of Object.keys(files)) fileInfo.set(key, fileOf(files[key]));
  const kindOfFile = (key: string): V1File => fileInfo.get(key) ?? { kind: 'wandb', table: null };

  interface Exp {
    name: string;
    base: string;
    prop: string;
    metrics: string[];
  }
  const experiments: Exp[] = [];
  for (const e of experimentsRaw) {
    const o = obj(e);
    if (typeof o.name !== 'string') continue;
    const f = obj(o.files);
    experiments.push({
      name: o.name,
      base: strOr(f.baseline, ''),
      prop: strOr(f.proposed, ''),
      metrics: Array.isArray(o.metrics) ? o.metrics.filter((m) => typeof m === 'string') : [],
    });
  }

  // Source kinds of the two sides: the kind of the first file used on that side.
  const baseKind: SourceKind =
    experiments.length > 0 ? kindOfFile(experiments[0].base).kind : 'repo';
  const propKind: SourceKind =
    experiments.length > 0 ? kindOfFile(experiments[0].prop).kind : 'wandb';

  // Collapse metrics by output_name: primary = the metric whose key equals it, else the first.
  const outName = (k: string): string => {
    const m = obj(metricsRaw[k]);
    return typeof m.output_name === 'string' && m.output_name !== '' ? m.output_name : k;
  };
  // A reserved name never becomes an object key here (it could reach a prototype); it is reported.
  const v1Keys = Object.keys(metricsRaw).filter((k) => {
    if (!RESERVED_KEYS.has(k) && !RESERVED_KEYS.has(outName(k))) return true;
    issues.push({
      code: 'key-reserved',
      severity: 'error',
      message: `metrics.${k}: reserved key; dropped`,
    });
    return false;
  });
  const primaryOf = new Map<string, string>(); // output_name -> primary v1 key
  for (const k of v1Keys) {
    const o = outName(k);
    if (k === o) primaryOf.set(o, k);
  }
  for (const k of v1Keys) {
    const o = outName(k);
    if (!primaryOf.has(o)) primaryOf.set(o, k);
  }
  const known = new Set(v1Keys);
  const collapsed = (k: string): string => (known.has(k) ? outName(k) : k);
  const isVariant = (k: string): boolean => known.has(k) && primaryOf.get(outName(k)) !== k;

  // v2 metrics in the v1 order of their primaries.
  const metrics: Record<string, unknown> = {};
  for (const k of v1Keys) {
    if (isVariant(k)) continue;
    const key = outName(k);
    const m = obj(metricsRaw[k]);
    const b = sideOf(m, 'baseline');
    const p = sideOf(m, 'proposed');
    const columns: Record<string, unknown> = {};
    if (b.column !== null) columns[baseKind] = { column: b.column, transforms: b.transforms };
    if (p.column !== null) {
      if (propKind !== baseKind) columns[propKind] = { column: p.column, transforms: p.transforms };
      else if (b.column !== null && p.column !== b.column) {
        issues.push({
          code: 'value-out-of-range',
          severity: 'warning',
          message: `metrics.${key}: both sides are ${baseKind} with different columns ("${b.column}" vs "${p.column}"); kept the baseline column`,
          target: { kind: 'metric', id: key },
        });
      } else if (b.column === null) {
        columns[propKind] = { column: p.column, transforms: p.transforms };
      }
    }
    const units = typeof m.units === 'string' && m.units !== '' ? m.units : undefined;
    const tolerance = has(m, 'tolerance') ? m.tolerance : 0;
    const isMatch =
      key === 'num_episodes' ||
      (units === undefined && tolerance === 0 && key.includes('episodes'));
    const direction = isMatch ? 'match' : m.higher_is_better === true ? 'higher' : 'lower';
    const metric: Record<string, unknown> = { label: v1Label(key) };
    if (units !== undefined) metric.units = units;
    metric.direction = direction;
    metric.tolerance = tolerance;
    metric.tolerance_mode = 'absolute';
    metric.decimals = lastRoundDecimals(b.column !== null ? b.transforms : p.transforms);
    metric.columns = columns;
    metrics[key] = metric;
  }

  // Override columns contributed by each variant (only the sides whose column differs).
  const variantOverride = (k: string): Partial<Record<SourceKind, string>> => {
    const primary = obj(metricsRaw[primaryOf.get(outName(k)) ?? k]);
    const v = obj(metricsRaw[k]);
    const pb = sideOf(primary, 'baseline').column;
    const pp = sideOf(primary, 'proposed').column;
    const vb = sideOf(v, 'baseline').column;
    const vp = sideOf(v, 'proposed').column;
    const out: Partial<Record<SourceKind, string>> = {};
    // Proposed first so the baseline side wins when both sides are the same kind.
    if (vp !== null && vp !== pp) out[propKind] = vp;
    if (vb !== null && vb !== pb) out[baseKind] = vb;
    return out;
  };

  // Groups: experiments with the same (baseline file, proposed file, variant set).
  interface G {
    key: string;
    exps: Exp[];
    variants: string[];
  }
  const groups = new Map<string, G>();
  for (const e of experiments) {
    const variants = [...new Set(e.metrics.filter(isVariant))].sort();
    const key = JSON.stringify([e.base, e.prop, variants]);
    let g = groups.get(key);
    if (!g) {
      g = { key, exps: [], variants };
      groups.set(key, g);
    }
    g.exps.push(e);
  }

  const taken = new Set<string>();
  const groupsOut: Record<string, unknown>[] = [];
  for (const g of groups.values()) {
    const first = g.exps[0];
    const bf = kindOfFile(first.base);
    const pf = kindOfFile(first.prop);
    const table = bf.kind === 'repo' ? bf.table : pf.kind === 'repo' ? pf.table : null;
    const base =
      table === null ? 'wandb' : (table.split('/').at(-1) ?? table).replace(/\.csv$/, '');
    const name = uniqueName(base, taken);
    const metricKeys: string[] = [];
    for (const e of g.exps) {
      for (const m of e.metrics) {
        const k = collapsed(m);
        if (!metricKeys.includes(k)) metricKeys.push(k);
      }
    }
    const overrides: Record<string, Record<string, string>> = {};
    for (const v of g.variants) {
      const o = variantOverride(v);
      const kinds = Object.keys(o) as SourceKind[];
      if (kinds.length === 0) continue;
      const key = outName(v);
      if (RESERVED_KEYS.has(key)) continue;
      const target = (overrides[key] ??= {});
      for (const kind of kinds) target[kind] = o[kind] as string;
    }
    groupsOut.push({
      name,
      table,
      metrics: metricKeys,
      column_overrides: overrides,
      experiments: g.exps.map((e) => e.name),
    });
  }

  // output.table → output.markdown (pass → same, na → missing, + mismatch).
  const table = obj(obj(doc.output).table);
  const markdown: Record<string, unknown> = {};
  for (const k of [
    'float_precision',
    'include_units_in_headers',
    'show_deltas',
    'show_pass_fail',
  ]) {
    if (has(table, k)) markdown[k] = table[k];
  }
  if (has(table, 'pass_fail_symbols')) {
    const s = obj(table.pass_fail_symbols);
    const symbols: Record<string, unknown> = {};
    if (has(s, 'pass')) symbols.same = s.pass;
    if (has(s, 'better')) symbols.better = s.better;
    if (has(s, 'worse')) symbols.worse = s.worse;
    symbols.mismatch = '⚠️';
    if (has(s, 'na')) symbols.missing = s.na;
    markdown.symbols = symbols;
  }

  return {
    value: {
      version: 2,
      name: 'v1-import',
      metrics,
      groups: groupsOut,
      charts: [],
      output: { markdown },
    },
    issues,
  };
}

/** A parsed v1 document → a structurally valid v2 config. */
export function importV1Value(raw: unknown): Config {
  return validateConfig(importV1Raw(raw).value).config;
}

/**
 * A v1 YAML text → v2 config. Parses with `parseYamlText` (the app's only YAML parser); throws an
 * Error with the parser's message when the text is not valid YAML (UI imports go through
 * `importConfigFile`, which never throws).
 */
export function importV1(yamlText: string): Config {
  const parsed = parseYamlText(yamlText);
  if ('error' in parsed) throw new Error(parsed.error);
  return importV1Value(parsed.value);
}
