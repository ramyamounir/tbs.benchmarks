/**
 * Every shared type of the app (spec Phase 1 "Core types"). This file is the single authoritative
 * definition: later modules import these and never redeclare or reshape them; a later phase may
 * only add optional fields when its spec says so. Keys inside `Config` are snake_case because they
 * are the YAML/JSON file format; every other type uses camelCase.
 */

export type SourceKind = 'repo' | 'wandb';
export type RunId = string; // Source.id

// ---- CSV ----
// records[0] is the header record; rows[i] is records[i + 1] parsed (unquoted field values).
export interface ParsedCsv {
  text: string;
  bom: boolean;
  eol: '\n' | '\r\n';
  header: string[];
  rows: string[][];
  records: CsvRecord[];
}
// Offsets are UTF-16 indices into ParsedCsv.text (text excludes the BOM). A record spans [start, end) without its
// terminator; terminator is '' only for a last record with no trailing line break. Field [start, end) includes the
// surrounding quotes when quoted === true. Write-back (rewriteRows) copies every byte outside the changed fields' spans verbatim from text.
export interface CsvRecord {
  start: number;
  end: number;
  terminator: '' | '\n' | '\r\n';
  fields: { start: number; end: number; quoted: boolean }[];
}

// ---- Sources ----
export interface Table {
  path: string;
  kind: SourceKind;
  idColumn: string | null;
  csv: ParsedCsv;
}
export interface Source {
  id: RunId;
  label: string;
  kind: SourceKind;
  origin: 'local' | 'github';
  tables: Table[];
  date: number | null; // epoch ms: local = max File.lastModified of its tables; github = Date.parse(meta.date); null = unknown (shown as "—")
  hidden: boolean;
  meta?: { owner: string; repo: string; ref: string; sha: string; date: string }; // github only; date = commit date, ISO 8601 as returned by the API
}
export interface LoadError {
  file: string; // path or label the error is about (rendered with <DisplayName>)
  message: string;
  reason:
    | 'unsupported'
    | 'undetected'
    | 'too-large'
    | 'too-many'
    | 'parse'
    | 'network'
    | 'rate-limited'
    | 'not-found'
    | 'max-runs';
}
export interface LoadProgress {
  opId: number;
  label: string;
  done: number;
  total: number;
}

// ---- Saved configs ----
export interface SavedConfigMeta {
  id: string;
  name: string;
  updatedAt: number;
}
export interface SavedConfig extends SavedConfigMeta {
  config: Config;
}

// ---- Validation ----
export type IssueCode =
  | 'table-missing'
  | 'metric-unknown'
  | 'experiment-duplicate'
  | 'column-missing'
  | 'group-empty'
  | 'metric-unused'
  | 'experiment-not-in-baseline'
  | 'experiments-unassigned'
  | 'source-kind-unmapped'
  | 'regex-invalid'
  | 'key-reserved'
  | 'unknown-key'
  | 'value-out-of-range'
  | 'transform-unknown'
  | 'chart-metric-unknown'
  | 'chart-group-unknown';
export interface ConfigIssue {
  code: IssueCode;
  severity: 'error' | 'warning';
  message: string;
  target?: { kind: 'group' | 'metric' | 'experiment' | 'chart'; id: string };
}

// ---- Config v2 ----
export type Direction = 'higher' | 'lower' | 'match';
export type Transform =
  | {
      kind:
        | 'lowercase'
        | 'uppercase'
        | 'trim'
        | 'to_number'
        | 'rad_to_deg'
        | 'deg_to_rad'
        | 'sec_to_min'
        | 'min_to_sec'
        | 'frac_to_percent'
        | 'percent_to_frac';
    }
  | { kind: 'strip_prefix'; value: string }
  | { kind: 'strip_suffix'; value: string }
  | { kind: 'regex_replace'; pattern: string; replacement: string }
  | { kind: 'round'; decimals: number }
  | { kind: 'scale'; factor: number }
  | { kind: 'clip'; min?: number; max?: number };
export interface ColumnSpec {
  column: string;
  transforms: Transform[];
}
export interface Metric {
  label: string;
  units?: string;
  direction: Direction;
  tolerance: number;
  tolerance_mode: 'absolute' | 'percent';
  decimals: number;
  columns: Partial<Record<SourceKind, ColumnSpec>>;
}
export type MatchMode = 'exact' | 'suffix' | { regex: string };
export interface Group {
  name: string;
  table: string | null; // repo-kind table path (Table.path, e.g. 'benchmarks/ycb_10objs.csv') used by EVERY repo-kind source, whichever role
  // (baseline or run) it plays; null = the config has no repo side (yet). Lookup rule: Phase 2a "Table lookup"
  match?: MatchMode; // overrides config.sources[kind].match for this group
  metrics: string[]; // metric keys, display order
  column_overrides: Record<string, Partial<Record<SourceKind, string>>>; // metricKey -> kind -> column
  experiments: string[];
}
export interface ChartDef {
  id: string;
  type: 'grouped_bars' | 'delta_dots' | 'small_multiples' | 'trend';
  metric: string;
  group: string;
  experiments: string[] | null; // null = every experiment of the group
  title?: string;
  options: { toleranceBand: boolean; deltaLabels: boolean; yFromZero: boolean };
}
export type Verdict = 'same' | 'better' | 'worse' | 'mismatch' | 'missing';
export interface Config {
  version: 2;
  name: string;
  description?: string;
  sources: Record<SourceKind, { id_column: string; match: MatchMode }>;
  metrics: Record<string, Metric>; // key = metric key; insertion order = display order
  groups: Group[];
  charts: ChartDef[];
  output: {
    markdown: {
      float_precision: number;
      include_units_in_headers: boolean;
      show_deltas: boolean;
      show_pass_fail: boolean;
      symbols: Record<Verdict, string>;
    };
  };
}

// ---- Comparison (produced by src/compare/compare.ts; semantics in Phase 2a "Comparison result") ----
export interface Coverage {
  found: number;
  total: number;
  partial: boolean;
}
export interface RowMatch {
  how: 'exact' | 'suffix' | 'regex' | 'none';
  index: number | null;
  candidates: number[];
  chosen: number | null;
}
// No heat step here: the Overview colour intensity depends on session.overview.cellColor, which the pure engine never
// sees; it is computed by heatStep() in src/views/overview/heat.ts (Phase 3 "Heat step").
export interface Cell {
  base: number | null;
  value: number | null;
  delta: number | null;
  verdict: Verdict;
  match: RowMatch;
}
export interface ExperimentRow {
  name: string;
  group: string;
  baseRow: RowMatch;
  cells: Record<RunId, Record<string /* metric key */, Cell>>;
  episodesMismatch: Record<RunId, boolean>;
}
export interface Comparison {
  groups: { group: Group; valid: boolean; experiments: ExperimentRow[] }[];
  runs: { source: Source; coverage: Coverage; counts: Record<Verdict, number> }[];
  unassigned: { table: string; sourceId: RunId; names: string[] }[];
  missing: { group: string; names: string[] }[]; // experiments listed in the config with no baseline row (Phase 2a "Comparison result")
}

/** A fresh, empty v2 config (spec Phase 1 "Initial config"); a new object on every call. */
export function emptyConfig(): Config {
  return {
    version: 2,
    name: 'untitled',
    sources: {
      repo: { id_column: 'Experiment', match: 'exact' },
      wandb: { id_column: 'Name', match: 'suffix' },
    },
    metrics: {},
    groups: [],
    charts: [],
    output: {
      markdown: {
        float_precision: 2,
        include_units_in_headers: true,
        show_deltas: true,
        show_pass_fail: true,
        symbols: { same: '⬜', better: '✅', worse: '❌', mismatch: '⚠️', missing: '—' },
      },
    },
  };
}
