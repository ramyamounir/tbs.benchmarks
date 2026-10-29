import type {
  ColumnSpec,
  Config,
  Direction,
  Group,
  Metric,
  Source,
  SourceKind,
  Table,
  Transform,
} from '../model/types';
import { emptyConfig } from '../model/types';
import { isValidMetricKey, LIMITS } from './schema';

/**
 * "Generate config from files" (spec Phase 2b "Column matching heuristics"; the wizard UI is
 * Phase 4b). `matchColumns` pairs repo-table columns with wandb-export columns by normalised name
 * and a synonym table; `generateConfig` turns the (user-edited) guesses into a v2 config with one
 * group per baseline table. Pure: no DOM, no store.
 */

export interface MetricGuess {
  key: string;
  label: string;
  units?: string;
  direction: Direction;
  tolerance: number;
  decimals: number;
  repo: ColumnSpec | null; // null = no column of that kind (shown as "not in baseline")
  wandb: ColumnSpec | null;
  known: boolean; // matched through the synonym table (else guessed from the name)
  variants: string[]; // per-LM wandb columns (`LM_2/<wandb column>`), offered as group overrides
}

export interface GenerateSources {
  baseline: Source;
  runs: readonly Source[];
}

export interface GenerateChoices {
  name?: string;
  /** The metrics to create, in order (the wizard's checked, possibly edited rows). */
  metrics: MetricGuess[];
  /** Per baseline table: group name and whether to create it (default: every table, basename). */
  groups?: { table: string; name: string; include: boolean }[];
  /** Run experiments matched by no group: an extra `wandb-only` group, or left unassigned. */
  wandbOnly?: 'group' | 'unassigned';
  /** metric key → group names that get the metric's first per-LM variant as a wandb override. */
  variantGroups?: Record<string, string[]>;
}

const T: Transform = { kind: 'to_number' };
const R = (decimals: number): Transform => ({ kind: 'round', decimals });

interface Synonym {
  repo: string;
  wandb: string;
  key: string;
  label: string;
  units?: string;
  direction: Direction;
  tolerance: number;
  decimals: number;
  clip?: boolean;
  wandbExtra?: Transform;
  round?: boolean;
}

// Normalised repo ↔ wandb names (spec table), in the built-in config's metric order.
const SYNONYMS: Synonym[] = [
  {
    repo: 'correct',
    wandb: 'percentcorrect',
    key: 'percent_correct',
    label: 'Correct',
    units: '%',
    direction: 'higher',
    tolerance: 0.1,
    decimals: 2,
    clip: true,
  },
  {
    repo: 'usedmlh',
    wandb: 'percentusedmlhaftertimeout',
    key: 'used_mlh',
    label: 'Used MLH',
    units: '%',
    direction: 'lower',
    tolerance: 0.1,
    decimals: 2,
  },
  {
    repo: 'nummatchsteps',
    wandb: 'avgnummontymatchingsteps',
    key: 'match_steps',
    label: 'Match steps',
    direction: 'lower',
    tolerance: 0.1,
    decimals: 0,
  },
  {
    repo: 'rotationerror',
    wandb: 'avgrotationerror',
    key: 'rotation_error',
    label: 'Rotation error',
    units: 'deg',
    direction: 'lower',
    tolerance: 0.01,
    decimals: 2,
  },
  {
    repo: 'avgpredictionerror',
    wandb: 'avgpredictionerror',
    key: 'prediction_error',
    label: 'Prediction error',
    direction: 'lower',
    tolerance: 0.01,
    decimals: 2,
  },
  {
    repo: 'runtime',
    wandb: 'runtime',
    key: 'runtime',
    label: 'Run time',
    units: 'min',
    direction: 'lower',
    tolerance: 0.05,
    decimals: 0,
    wandbExtra: { kind: 'sec_to_min' },
  },
  {
    repo: 'episoderuntime',
    wandb: 'avgepisoderuntime',
    key: 'episode_runtime',
    label: 'Episode time',
    units: 's',
    direction: 'lower',
    tolerance: 0.05,
    decimals: 0,
  },
  {
    repo: 'numepisodes',
    wandb: 'numepisodes',
    key: 'num_episodes',
    label: 'Episodes',
    direction: 'match',
    tolerance: 0,
    decimals: 0,
  },
];

/** Id and bookkeeping columns that are never metrics. */
const NON_METRIC = new Set(['experiment', 'name', 'state', 'tags', 'notes']);
const LM_VARIANT_RE = /^LM_\d+\/(.+)$/;

/**
 * Normalised header: lower-cased, `|align right` / `|hidden` suffixes, a leading `overall/` and text
 * in parentheses removed, then every non-alphanumeric character removed.
 */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\|(align right|hidden)\s*$/, '')
    .trim()
    .replace(/^overall\//, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** snake_case metric key of a header (always a valid, non-reserved metric key). */
function snakeKey(h: string): string {
  let k = h
    .replace(/\|.*$/, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/^overall\//i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(k)) k = `m_${k}`;
  k = k.slice(0, 64).replace(/_+$/, '');
  return isValidMetricKey(k) ? k : 'metric';
}

function guessDirection(h: string): Direction {
  const n = h.toLowerCase();
  if (/error|time|steps|loss/.test(n)) return 'lower';
  if (/correct|accuracy|score/.test(n)) return 'higher';
  return 'lower';
}

function uniqueKey(base: string, taken: Set<string>): string {
  let key = base;
  for (let n = 2; taken.has(key); n++) {
    const suffix = `_${n}`;
    key = base.slice(0, 64 - suffix.length) + suffix;
  }
  taken.add(key);
  return key;
}

const isMetricColumn = (h: string): boolean =>
  h.trim() !== '' && !NON_METRIC.has(h.trim().toLowerCase());

/** First header per normalised name, in input order. */
function byNorm(headers: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of headers) {
    const n = normalizeHeader(h);
    if (n !== '' && !m.has(n)) m.set(n, h);
  }
  return m;
}

/**
 * Pair repo and wandb columns. Synonym-table matches come first (a synonym is proposed when at
 * least one side has the column), then unknown pairs with equal normalised names. When one side
 * has no headers at all (repo vs repo, wandb vs wandb), every column of the other side is proposed.
 */
export function matchColumns(
  repoHeaders: readonly string[],
  wandbHeaders: readonly string[],
): MetricGuess[] {
  const repo = [...new Set(repoHeaders)].filter(isMetricColumn);
  const wandbAll = [...new Set(wandbHeaders)].filter(isMetricColumn);
  const wandb = wandbAll.filter((h) => !LM_VARIANT_RE.test(h));
  const repoByNorm = byNorm(repo);
  const wandbByNorm = byNorm(wandb);
  const usedRepo = new Set<string>();
  const usedWandb = new Set<string>();
  const keys = new Set<string>();
  const out: MetricGuess[] = [];

  for (const s of SYNONYMS) {
    const r = repoByNorm.get(s.repo);
    const w = wandbByNorm.get(s.wandb);
    if (r === undefined && w === undefined) continue;
    if (r !== undefined) usedRepo.add(s.repo);
    if (w !== undefined) usedWandb.add(s.wandb);
    const base: Transform[] = s.clip ? [T, { kind: 'clip', min: 0, max: 100 }] : [T];
    const guess: MetricGuess = {
      key: uniqueKey(s.key, keys),
      label: s.label,
      direction: s.direction,
      tolerance: s.tolerance,
      decimals: s.decimals,
      repo: r === undefined ? null : { column: r, transforms: [...base, R(s.decimals)] },
      wandb:
        w === undefined
          ? null
          : {
              column: w,
              transforms: [...base, ...(s.wandbExtra ? [s.wandbExtra] : []), R(s.decimals)],
            },
      known: true,
      variants: [],
    };
    if (s.units !== undefined) guess.units = s.units;
    out.push(guess);
  }

  const unknown = (header: string, r: string | null, w: string | null): MetricGuess => ({
    key: uniqueKey(snakeKey(header), keys),
    label: header.replace(/\|.*$/, '').trim() || header,
    direction: guessDirection(header),
    tolerance: 0.1,
    decimals: 2,
    repo: r === null ? null : { column: r, transforms: [T] },
    wandb: w === null ? null : { column: w, transforms: [T] },
    known: false,
    variants: [],
  });
  if (repo.length > 0 && wandb.length > 0) {
    for (const [n, r] of repoByNorm) {
      if (usedRepo.has(n) || usedWandb.has(n)) continue;
      const w = wandbByNorm.get(n);
      if (w === undefined) continue;
      usedRepo.add(n);
      usedWandb.add(n);
      out.push(unknown(r, r, w));
    }
  } else if (wandb.length === 0) {
    // One side only: every remaining column (two columns may share a normalised name).
    for (const r of repo) if (!usedRepo.has(normalizeHeader(r))) out.push(unknown(r, r, null));
  } else {
    for (const w of wandb) if (!usedWandb.has(normalizeHeader(w))) out.push(unknown(w, null, w));
  }

  // Per-LM variants of a matched wandb column (`LM_2/overall/x` for `overall/x`).
  for (const h of wandbAll) {
    const m = LM_VARIANT_RE.exec(h);
    if (!m) continue;
    const g = out.find((x) => x.wandb !== null && x.wandb.column === m[1]);
    if (g) g.variants.push(h);
  }
  return out;
}

/** Metric columns no guess uses (listed as "unmatched"; they can be added manually). */
export function unmatchedColumns(
  repoHeaders: readonly string[],
  wandbHeaders: readonly string[],
  guesses: readonly MetricGuess[],
): { repo: string[]; wandb: string[] } {
  const repoNorms = new Set(
    guesses.flatMap((g) => (g.repo ? [normalizeHeader(g.repo.column)] : [])),
  );
  const wandbCols = new Set(
    guesses.flatMap((g) => [...(g.wandb ? [g.wandb.column] : []), ...g.variants]),
  );
  return {
    repo: [...new Set(repoHeaders)].filter(
      (h) => isMetricColumn(h) && !repoNorms.has(normalizeHeader(h)),
    ),
    wandb: [...new Set(wandbHeaders)].filter((h) => isMetricColumn(h) && !wandbCols.has(h)),
  };
}

/** Headers of every loaded table of a kind, baseline tables first, in table order. */
export function headersOf(sources: GenerateSources, kind: SourceKind): string[] {
  const out: string[] = [];
  for (const s of [sources.baseline, ...sources.runs]) {
    if (s.kind !== kind) continue;
    for (const t of s.tables) for (const h of t.csv.header) if (!out.includes(h)) out.push(h);
  }
  return out;
}

/** The ids of a table (trimmed, non-empty, deduplicated, file order). */
function tableIds(table: Table, idColumn: string): string[] {
  let c = table.csv.header.indexOf(idColumn);
  if (c < 0 && table.idColumn !== null) c = table.csv.header.indexOf(table.idColumn);
  if (c < 0) return [];
  const out = new Set<string>();
  for (const row of table.csv.rows) {
    const id = (row[c] ?? '').trim();
    if (id !== '') out.add(id);
  }
  return [...out];
}

/**
 * A wandb run id without its 8-character run-id suffix (`name_k3b9xq2e` → `name`). Run ids are
 * random base-36, so a suffix is stripped only when it has a digit or at most 2 vowels — an English
 * word such as `location` is kept (heuristic; the user can edit the names afterwards).
 */
export function stripRunId(id: string): string {
  const m = /^(.+)_([a-z0-9]{8})$/.exec(id);
  if (!m) return id;
  const vowels = m[2].replace(/[^aeiou]/g, '').length;
  return /\d/.test(m[2]) || vowels <= 2 ? m[1] : id;
}

/** `name` matches experiment `e` exactly or through the v1 run-id suffix rule. */
function matchesAny(name: string, experiments: ReadonlySet<string>): boolean {
  if (experiments.has(name)) return true;
  for (let i = 1; i < name.length - 1; i++) {
    if ('_-/:.'.includes(name[i]) && experiments.has(name.slice(0, i))) return true;
  }
  return false;
}

const basename = (path: string): string => (path.split('/').at(-1) ?? path).replace(/\.csv$/i, '');

/** The wizard's starting point: every guess, every baseline table, default variant groups. */
export function proposeChoices(sources: GenerateSources): GenerateChoices {
  const metrics = matchColumns(headersOf(sources, 'repo'), headersOf(sources, 'wandb'));
  const ids = emptyConfig().sources;
  const groups =
    sources.baseline.kind === 'repo'
      ? sources.baseline.tables.map((t) => ({
          table: t.path,
          name: basename(t.path),
          include: true,
        }))
      : [];

  // A group gets a metric's LM variant by default when every experiment of it that a wandb run
  // has carries a value in the variant column (i.e. its runs report per-LM results).
  const variantGroups: Record<string, string[]> = {};
  const wandbRuns = sources.runs.filter((r) => r.kind === 'wandb');
  for (const g of metrics) {
    if (g.variants.length === 0 || sources.baseline.kind !== 'repo') continue;
    const picked: string[] = [];
    for (const grp of groups) {
      const table = sources.baseline.tables.find((t) => t.path === grp.table);
      if (!table) continue;
      const exps = new Set(tableIds(table, ids.repo.id_column));
      let seen = 0;
      let all = true;
      for (const run of wandbRuns) {
        const t = run.tables[0];
        if (!t) continue;
        const idc = t.csv.header.indexOf(ids.wandb.id_column);
        const vc = t.csv.header.indexOf(g.variants[0]);
        if (idc < 0 || vc < 0) continue;
        for (const row of t.csv.rows) {
          if (!matchesAny((row[idc] ?? '').trim(), exps)) continue;
          seen++;
          if ((row[vc] ?? '').trim() === '') all = false;
        }
      }
      if (seen > 0 && all) picked.push(grp.name);
    }
    if (picked.length > 0) variantGroups[g.key] = picked;
  }
  return { metrics, groups, wandbOnly: 'unassigned', variantGroups };
}

function toMetric(g: MetricGuess): Metric {
  const columns: Metric['columns'] = {};
  if (g.repo)
    columns.repo = { column: g.repo.column, transforms: g.repo.transforms.map((t) => ({ ...t })) };
  if (g.wandb)
    columns.wandb = {
      column: g.wandb.column,
      transforms: g.wandb.transforms.map((t) => ({ ...t })),
    };
  const base = {
    label: g.label.slice(0, LIMITS.stringLength),
    direction: g.direction,
    tolerance: Number.isFinite(g.tolerance) && g.tolerance >= 0 ? g.tolerance : 0,
    tolerance_mode: 'absolute' as const,
    decimals: Number.isInteger(g.decimals) && g.decimals >= 0 && g.decimals <= 10 ? g.decimals : 2,
    columns,
  };
  return g.units === undefined
    ? base
    : {
        label: base.label,
        units: g.units,
        direction: base.direction,
        tolerance: base.tolerance,
        tolerance_mode: base.tolerance_mode,
        decimals: base.decimals,
        columns,
      };
}

/**
 * Build a config from the loaded sources and the wizard's choices: the chosen metrics, one group
 * per included baseline table (repo baseline) with exactly that table's experiments, or one `wandb`
 * group (wandb baseline), plus optionally a `wandb-only` group for run experiments in no group.
 */
export function generateConfig(sources: GenerateSources, choices: GenerateChoices): Config {
  const config = emptyConfig();
  config.name = (choices.name ?? `generated from ${sources.baseline.label}`).slice(
    0,
    LIMITS.stringLength,
  );
  const guesses: MetricGuess[] = [];
  for (const g of choices.metrics) {
    if (!isValidMetricKey(g.key) || Object.hasOwn(config.metrics, g.key)) continue;
    if (guesses.length >= LIMITS.metrics) break;
    config.metrics[g.key] = toMetric(g);
    guesses.push(g);
  }
  const ids = config.sources;
  const taken = new Set<string>();
  const uniqueName = (base: string): string => {
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    taken.add(name);
    return name;
  };
  const wandbKeys = guesses.filter((g) => g.wandb !== null).map((g) => g.key);

  if (sources.baseline.kind === 'repo') {
    const plan =
      choices.groups ??
      sources.baseline.tables.map((t) => ({
        table: t.path,
        name: basename(t.path),
        include: true,
      }));
    for (const p of plan) {
      if (!p.include) continue;
      const table = sources.baseline.tables.find((t) => t.path === p.table);
      if (!table) continue;
      const header = table.csv.header;
      const name = uniqueName(p.name.trim() === '' ? basename(p.table) : p.name);
      const metrics: string[] = [];
      const overrides: Group['column_overrides'] = {};
      for (const g of guesses) {
        if (!g.repo) continue;
        if (!header.includes(g.repo.column)) {
          // Same column under a slightly different header (e.g. a leading space): an override.
          const n = normalizeHeader(g.repo.column);
          const alt = header.find((h) => isMetricColumn(h) && normalizeHeader(h) === n);
          if (alt === undefined) continue;
          overrides[g.key] = { repo: alt };
        }
        metrics.push(g.key);
      }
      config.groups.push({
        name,
        table: table.path,
        metrics,
        column_overrides: overrides,
        experiments: tableIds(table, ids.repo.id_column).slice(0, LIMITS.experimentsPerGroup),
      });
    }
  } else {
    const t = sources.baseline.tables[0];
    const names = t ? [...new Set(tableIds(t, ids.wandb.id_column).map(stripRunId))] : [];
    config.groups.push({
      name: uniqueName('wandb'),
      table: null,
      metrics: wandbKeys,
      column_overrides: {},
      experiments: names.slice(0, LIMITS.experimentsPerGroup),
    });
  }

  // Per-LM variants as wandb overrides on the chosen groups.
  for (const g of guesses) {
    const targets =
      choices.variantGroups && Object.hasOwn(choices.variantGroups, g.key)
        ? choices.variantGroups[g.key]
        : [];
    if (g.variants.length === 0 || targets.length === 0) continue;
    for (const grp of config.groups) {
      if (!targets.includes(grp.name) || !grp.metrics.includes(g.key)) continue;
      const prev = Object.hasOwn(grp.column_overrides, g.key) ? grp.column_overrides[g.key] : {};
      grp.column_overrides[g.key] = { ...prev, wandb: g.variants[0] };
    }
  }

  if (choices.wandbOnly === 'group') {
    const assigned = new Set(config.groups.flatMap((g) => g.experiments));
    const extra = new Set<string>();
    for (const run of sources.runs) {
      if (run.kind !== 'wandb' || !run.tables[0]) continue;
      for (const id of tableIds(run.tables[0], ids.wandb.id_column)) {
        if (!matchesAny(id, assigned)) extra.add(stripRunId(id));
      }
    }
    if (extra.size > 0 && config.groups.length < LIMITS.groups) {
      config.groups.push({
        name: uniqueName('wandb-only'),
        table: null,
        metrics: wandbKeys,
        column_overrides: {},
        experiments: [...extra].slice(0, LIMITS.experimentsPerGroup),
      });
    }
  }
  config.groups = config.groups.slice(0, LIMITS.groups);
  return config;
}
