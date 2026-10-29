import { groupTable, rowChoiceKey } from '../../compare/compare';
import { findRows, idIndex } from '../../compare/match';
import { LIMITS, isValidMetricKey } from '../../config/schema';
import { stripRunId } from '../../config/generate';
import type {
  Config,
  Group,
  MatchMode,
  Metric,
  Source,
  SourceKind,
  Table,
} from '../../model/types';

/*
 * Pure, React-free logic of the Config view (spec Phase 4a): the "From your files" model, the
 * Files panel selection rule, pasted-name parsing and the group mutations the editors commit
 * through `updateConfig`. Renames and deletes of groups/metrics never happen here (they go through
 * the store's reference-safe actions).
 */

const SEPARATORS = '_-/:.';

/**
 * Every name an id can be matched by: the id itself and, unless `exact`, every prefix that the v1
 * run-id suffix rule `^name([_\-/:.].+)?$` accepts (a prefix ending right before a separator that
 * is followed by at least one character).
 */
function addKeys(out: Set<string>, id: string, exact: boolean) {
  out.add(id);
  if (exact) return;
  for (let i = 1; i < id.length - 1; i++) if (SEPARATORS.includes(id[i])) out.add(id.slice(0, i));
}

// One key set per parsed table, id column and mode; a new load gets new sets.
const keyCache = new WeakMap<Table['csv'], Map<string, Set<string>>>();

/**
 * Names that have a row in `table` (presence dots of the Files panel). A user regex mode is shown
 * like the suffix rule: the dots are an indicator; the Group editor's ✓ column runs the real rule.
 */
export function tableNameKeys(table: Table, idColumn: string, mode: MatchMode): Set<string> {
  const exact = mode === 'exact';
  const cacheKey = `${idColumn}\u0000${exact ? 'exact' : 'suffix'}`;
  let byKey = keyCache.get(table.csv);
  if (!byKey) {
    byKey = new Map();
    keyCache.set(table.csv, byKey);
  }
  const hit = byKey.get(cacheKey);
  if (hit) return hit;
  const out = new Set<string>();
  for (const id of idIndex(table, idColumn).keys()) if (id !== '') addKeys(out, id, exact);
  byKey.set(cacheKey, out);
  return out;
}

export interface FilesRow {
  name: string;
  /** One entry per loaded source, in `[baseline, ...runs]` order. */
  presence: boolean[];
  assigned: boolean;
}
export interface FilesSection {
  /** Repo table path, or `WANDB_ONLY`. */
  id: string;
  rows: FilesRow[];
}
export interface FilesModel {
  sections: FilesSection[];
  total: number;
  assigned: number;
  unassigned: number;
}
export const WANDB_ONLY = '\u0000wandb-only';

const idColumnOf = (config: Config, kind: SourceKind) => config.sources[kind].id_column;
const modeOf = (config: Config, kind: SourceKind) => config.sources[kind].match;

/** Every experiment name assigned to some group. */
export function assignedNames(config: Config): Set<string> {
  return new Set(config.groups.flatMap((g) => g.experiments));
}

/**
 * "From your files": every experiment found in the loaded sources, grouped by repo table (in
 * source order, baseline first) plus a "wandb only" section for wandb runs that match no repo
 * experiment (shown without their run-id suffix), each with presence per source and whether a
 * group lists it.
 */
export function filesModel(config: Config, sources: readonly Source[]): FilesModel {
  const assigned = assignedNames(config);
  const sections = new Map<string, string[]>();
  const seen = new Set<string>();
  const repoKeys = new Set<string>();

  for (const source of sources) {
    if (source.kind !== 'repo') continue;
    const idc = idColumnOf(config, 'repo');
    for (const table of source.tables) {
      let names = sections.get(table.path);
      if (!names) {
        names = [];
        sections.set(table.path, names);
      }
      for (const id of idIndex(table, idc).keys()) {
        if (id === '' || seen.has(id)) continue;
        seen.add(id);
        names.push(id);
        repoKeys.add(id);
      }
    }
  }

  const wandbOnly: string[] = [];
  for (const source of sources) {
    if (source.kind !== 'wandb') continue;
    const table = source.tables[0];
    if (!table) continue;
    for (const id of idIndex(table, idColumnOf(config, 'wandb')).keys()) {
      if (id === '') continue;
      const keys = new Set<string>();
      addKeys(keys, id, false);
      if ([...keys].some((k) => repoKeys.has(k))) continue; // a run of a repo experiment
      const name = stripRunId(id);
      if (seen.has(name)) continue;
      seen.add(name);
      wandbOnly.push(name);
    }
  }

  const presenceOf = (name: string, sectionId: string): boolean[] =>
    sources.map((source) => {
      const idc = idColumnOf(config, source.kind);
      const mode = modeOf(config, source.kind);
      const tables =
        source.kind === 'wandb'
          ? source.tables.slice(0, 1)
          : sectionId === WANDB_ONLY
            ? source.tables
            : source.tables.filter((t) => t.path === sectionId);
      return tables.some((t) => tableNameKeys(t, idc, mode).has(name));
    });

  const out: FilesSection[] = [];
  let nAssigned = 0;
  const build = (id: string, names: string[]) => {
    if (names.length === 0) return;
    const rows = names.map((name) => {
      const a = assigned.has(name);
      if (a) nAssigned++;
      return { name, presence: presenceOf(name, id), assigned: a };
    });
    out.push({ id, rows });
  };
  for (const [path, names] of sections) build(path, names);
  build(WANDB_ONLY, wandbOnly);
  const total = out.reduce((n, s) => n + s.rows.length, 0);
  return { sections: out, total, assigned: nAssigned, unassigned: total - nAssigned };
}

export type FilesFilter = 'unassigned' | 'assigned' | 'all';

/** Sections with only the rows passing the segmented filter and the (case-insensitive) text. */
export function filterFiles(
  sections: readonly FilesSection[],
  filter: FilesFilter,
  text: string,
): FilesSection[] {
  const q = text.trim().toLowerCase();
  const out: FilesSection[] = [];
  for (const s of sections) {
    const rows = s.rows.filter(
      (r) =>
        (filter === 'all' || r.assigned === (filter === 'assigned')) &&
        (q === '' || r.name.toLowerCase().includes(q)),
    );
    if (rows.length > 0) out.push({ id: s.id, rows });
  }
  return out;
}

/** Labels of the sources holding at least one unassigned experiment (amber review card). */
export function unassignedSourceLabels(model: FilesModel, sources: readonly Source[]): string[] {
  const used = new Set<number>();
  for (const s of model.sections)
    for (const r of s.rows) if (!r.assigned) r.presence.forEach((p, i) => p && used.add(i));
  return sources.filter((_, i) => used.has(i)).map((s) => s.label);
}

/**
 * Text that follows item `index` of an `n`-item prose list ("a, b and c"): `','` between items,
 * `' and'` before the last one, `''` after it. The leading space of `' and'` is significant, so
 * the caller must render it inside normal inline flow (not as its own flex item, where leading
 * whitespace collapses and "x.csvand" appears).
 */
export function listSeparator(index: number, n: number): string {
  if (index < n - 2) return ',';
  if (index === n - 2) return ' and';
  return '';
}

/**
 * Files panel click rule (stored in `session.config.selectedExperiments`): a plain click selects
 * `[name]`; ctrl/cmd toggles `name`; shift adds the visible range between the last-selected name
 * and `name` (in rendered order), ending with `name`. No duplicates; selection order is kept.
 */
export function clickSelection(
  current: readonly string[],
  name: string,
  mods: { shift: boolean; toggle: boolean },
  visible: readonly string[],
): string[] {
  if (mods.toggle) {
    return current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
  }
  if (mods.shift && current.length > 0) {
    const anchor = current[current.length - 1];
    const a = visible.indexOf(anchor);
    const b = visible.indexOf(name);
    if (a >= 0 && b >= 0) {
      const range = a <= b ? visible.slice(a, b + 1) : visible.slice(b, a + 1).reverse();
      const out = [...current];
      for (const n of range) if (!out.includes(n)) out.push(n);
      // `name` becomes the last-selected (anchor of the next shift-click).
      return [...out.filter((n) => n !== name), name];
    }
  }
  return [name];
}

/** Pasted names: split by newlines/commas, trimmed, empty dropped, deduplicated (first wins). */
export function parseNames(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\r\n,]+/)) {
    const name = raw.trim();
    if (name !== '' && !out.includes(name)) out.push(name);
  }
  return out;
}

export type EditResult = { config: Config; message?: string } | { error: string };

/**
 * Adds `names` to group `groupName` (appended, in order). An experiment listed in another group is
 * moved (an experiment in two groups is a validation error). Refused when the group would exceed
 * LIMITS.experimentsPerGroup; names longer than LIMITS.stringLength are skipped with a message.
 */
export function addExperiments(
  config: Config,
  groupName: string,
  names: readonly string[],
): EditResult {
  const gi = config.groups.findIndex((g) => g.name === groupName);
  if (gi < 0) return { error: 'No group selected' };
  const tooLong = names.filter((n) => n.length > LIMITS.stringLength).length;
  const ok = names.filter((n) => n.length <= LIMITS.stringLength && n.trim() !== '');
  const target = config.groups[gi];
  const fresh = [...new Set(ok)].filter((n) => !target.experiments.includes(n));
  if (target.experiments.length + fresh.length > LIMITS.experimentsPerGroup) {
    return { error: `A group holds at most ${LIMITS.experimentsPerGroup} experiments` };
  }
  const moving = new Set(fresh);
  const groups = config.groups.map((g, i) =>
    i === gi
      ? { ...g, experiments: [...g.experiments, ...fresh] }
      : g.experiments.some((e) => moving.has(e))
        ? { ...g, experiments: g.experiments.filter((e) => !moving.has(e)) }
        : g,
  );
  const message =
    tooLong > 0
      ? `${tooLong} ${tooLong === 1 ? 'name is' : 'names are'} longer than ${LIMITS.stringLength} characters and ${tooLong === 1 ? 'was' : 'were'} skipped`
      : undefined;
  return message === undefined
    ? { config: { ...config, groups } }
    : { config: { ...config, groups }, message };
}

/** `list` with the item at `from` moved to `to` (same list when out of range or unchanged). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to)
    return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/** Replaces group `name` by `mutate(group)` (other groups shared). */
export function updateGroup(config: Config, name: string, mutate: (g: Group) => Group): Config {
  return { ...config, groups: config.groups.map((g) => (g.name === name ? mutate(g) : g)) };
}

/** `base`, `base_2`, `base_3`, … — the first not in `taken`. */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const name = `${base}_${i}`;
    if (!taken.has(name)) return name;
  }
}

/** "+ New group": an empty group reading the first loaded baseline table no group uses yet. */
export function newGroup(config: Config, baseline: Source | null): EditResult {
  if (config.groups.length >= LIMITS.groups) {
    return { error: `A config holds at most ${LIMITS.groups} groups` };
  }
  const used = new Set(config.groups.map((g) => g.table));
  const table =
    baseline?.kind === 'repo'
      ? (baseline.tables.find((t) => !used.has(t.path))?.path ?? null)
      : null;
  const base = table ? (table.split('/').at(-1) ?? 'group').replace(/\.csv$/i, '') : 'new_group';
  const name = uniqueName(base, new Set(config.groups.map((g) => g.name)));
  const group: Group = { name, table, metrics: [], column_overrides: {}, experiments: [] };
  return { config: { ...config, groups: [...config.groups, group] } };
}

/** "Duplicate" in the group `…` menu: same table, match, metrics and overrides, no experiments. */
export function duplicateGroup(config: Config, name: string): EditResult {
  const i = config.groups.findIndex((g) => g.name === name);
  if (i < 0) return { error: 'No such group' };
  if (config.groups.length >= LIMITS.groups) {
    return { error: `A config holds at most ${LIMITS.groups} groups` };
  }
  const g = config.groups[i];
  const copyName = uniqueName(
    `${g.name}_copy`.slice(0, LIMITS.stringLength - 4),
    new Set(config.groups.map((x) => x.name)),
  );
  const copy: Group = { ...structuredClone(g), name: copyName, experiments: [] };
  const groups = [...config.groups];
  groups.splice(i + 1, 0, copy);
  return { config: { ...config, groups } };
}

/** "+ New metric": a fresh metric with a unique valid key (`metric`, `metric_2`, …). */
export function newMetric(config: Config): EditResult & { key?: string } {
  if (Object.keys(config.metrics).length >= LIMITS.metrics) {
    return { error: `A config holds at most ${LIMITS.metrics} metrics` };
  }
  const key = uniqueName('metric', new Set(Object.keys(config.metrics)));
  if (!isValidMetricKey(key)) return { error: 'Could not create a metric key' };
  const metric: Metric = {
    label: 'New metric',
    direction: 'higher',
    tolerance: 0,
    tolerance_mode: 'absolute',
    decimals: 2,
    columns: {},
  };
  const metrics: Record<string, Metric> = {};
  for (const k of Object.keys(config.metrics)) metrics[k] = config.metrics[k];
  metrics[key] = metric;
  return { config: { ...config, metrics }, key };
}

/** Name of a group: refused when empty, too long or used by another group ("Editor input rule"). */
export function groupNameError(config: Config, current: string, draft: string): string | null {
  if (draft.trim() === '') return 'A group needs a name';
  if (draft.length > LIMITS.stringLength) return `At most ${LIMITS.stringLength} characters`;
  if (draft !== current && config.groups.some((g) => g.name === draft)) {
    return 'Another group already has this name';
  }
  return null;
}

/** Row lookup of one experiment in one source for a group (the ✓ / — / "n rows" cell). */
export interface Presence {
  table: Table | null;
  candidates: number[];
  chosen: number | null;
  /** True when a valid `session.rowChoices` override picks the row. */
  override: boolean;
}

export function presenceIn(
  config: Config,
  group: Group,
  source: Source,
  name: string,
  rowChoices: Record<string, number>,
): Presence {
  const table = groupTable(group, source);
  if (table === null) return { table, candidates: [], chosen: null, override: false };
  const kind = config.sources[source.kind];
  const { indices } = findRows(table, kind.id_column, name, group.match ?? kind.match);
  if (indices.length === 0) return { table, candidates: [], chosen: null, override: false };
  const key = rowChoiceKey(source.id, table.path, name);
  const r = Object.hasOwn(rowChoices, key) ? rowChoices[key] : undefined;
  const override = r !== undefined && indices.includes(r);
  return { table, candidates: indices, chosen: override ? (r as number) : indices[0], override };
}

/**
 * The live "matches n rows" count of a group regex: matched rows summed over the group's
 * (deduplicated) experiments in the baseline's table for the group.
 */
export function regexMatchCount(
  config: Config,
  group: Group,
  baseline: Source,
  regex: string,
): number {
  const table = groupTable(group, baseline);
  if (table === null) return 0;
  const idc = config.sources[baseline.kind].id_column;
  let n = 0;
  for (const name of new Set(group.experiments))
    n += findRows(table, idc, name, { regex }).indices.length;
  return n;
}

/** The column a group reads for a metric and source kind (group override first). */
export function effectiveColumn(
  group: Group,
  key: string,
  metric: Metric,
  kind: SourceKind,
): string | null {
  if (Object.hasOwn(group.column_overrides, key)) {
    const o = group.column_overrides[key];
    if (Object.hasOwn(o, kind) && typeof o[kind] === 'string') return o[kind] as string;
  }
  const spec = Object.hasOwn(metric.columns, kind) ? metric.columns[kind] : undefined;
  return spec ? spec.column : null;
}

/** Ghost chip: the baseline table of the group lacks the metric's column. */
export function metricMissingInBaseline(
  config: Config,
  group: Group,
  key: string,
  baseline: Source | null,
): boolean {
  if (!baseline || !Object.hasOwn(config.metrics, key)) return false;
  const table = groupTable(group, baseline);
  if (table === null) return false;
  const column = effectiveColumn(group, key, config.metrics[key], baseline.kind);
  return column === null || !table.csv.header.includes(column);
}

/** Every distinct column per source kind, in source order (baseline first). */
export function columnsByKind(sources: readonly Source[]): Record<SourceKind, string[]> {
  const out: Record<SourceKind, string[]> = { repo: [], wandb: [] };
  const seen: Record<SourceKind, Set<string>> = { repo: new Set(), wandb: new Set() };
  for (const s of sources) {
    for (const t of s.kind === 'wandb' ? s.tables.slice(0, 1) : s.tables) {
      for (const h of t.csv.header) {
        if (seen[s.kind].has(h)) continue;
        seen[s.kind].add(h);
        out[s.kind].push(h);
      }
    }
  }
  return out;
}

/** Metric keys reading `column` for `kind` (as the metric column or a group override). */
export function columnUsers(config: Config, kind: SourceKind, column: string): string[] {
  const out: string[] = [];
  for (const key of Object.keys(config.metrics)) {
    const m = config.metrics[key];
    const spec = Object.hasOwn(m.columns, kind) ? m.columns[kind] : undefined;
    const viaOverride = config.groups.some(
      (g) => Object.hasOwn(g.column_overrides, key) && g.column_overrides[key][kind] === column,
    );
    if (spec?.column === column || viaOverride) out.push(key);
  }
  return out;
}

/** Sets metric `key`'s column for `kind`, keeping its transforms (Files panel column drag). */
export function assignColumn(
  config: Config,
  key: string,
  kind: SourceKind,
  column: string,
): EditResult {
  if (!Object.hasOwn(config.metrics, key)) return { error: 'Select a metric first' };
  if (column.length > LIMITS.stringLength) return { error: 'Column name is too long' };
  const m = config.metrics[key];
  const prev = Object.hasOwn(m.columns, kind) ? m.columns[kind] : undefined;
  const columns = { ...m.columns, [kind]: { column, transforms: prev ? prev.transforms : [] } };
  const metrics: Record<string, Metric> = {};
  for (const k of Object.keys(config.metrics))
    metrics[k] = k === key ? { ...m, columns } : config.metrics[k];
  return { config: { ...config, metrics } };
}

/** Tables offered by the "Baseline table" select: loaded repo tables (baseline first), then the config's unloaded ones. */
export function tableOptions(
  config: Config,
  sources: readonly Source[],
): { path: string; loaded: boolean }[] {
  const out: { path: string; loaded: boolean }[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (s.kind !== 'repo') continue;
    for (const t of s.tables) {
      if (seen.has(t.path)) continue;
      seen.add(t.path);
      out.push({ path: t.path, loaded: true });
    }
  }
  for (const g of config.groups) {
    if (g.table === null || seen.has(g.table)) continue;
    seen.add(g.table);
    out.push({ path: g.table, loaded: false });
  }
  return out;
}
