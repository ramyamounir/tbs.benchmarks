import { findRows } from '../../compare/match';
import {
  generateConfig,
  headersOf,
  matchColumns,
  proposeChoices,
  unmatchedColumns,
  type GenerateChoices,
  type GenerateSources,
  type MetricGuess,
} from '../../config/generate';
import { LIMITS } from '../../config/schema';
import type { ColumnSpec, Config, Source, SourceKind, Table } from '../../model/types';
import { emptyConfig } from '../../model/types';

/*
 * Pure state of the "Generate config from files" wizard (spec Phase 4b, reference/07): the rows of
 * step 2 (guesses + include flag), the per-table summaries and name checks of step 3, and the
 * final `GenerateChoices` handed to `generateConfig` (Phase 2b).
 */

export interface WizardRow extends MetricGuess {
  include: boolean;
}

export interface WizardPlan {
  table: string;
  name: string;
  include: boolean;
}

export interface WizardState {
  rows: WizardRow[];
  plan: WizardPlan[];
  variantsOn: boolean;
  /** Table paths whose group gets the per-LM variants as wandb overrides. */
  variantTables: string[];
  wandbOnly: 'group' | 'unassigned';
}

const basename = (path: string): string => (path.split('/').at(-1) ?? path).replace(/\.csv$/i, '');

/**
 * The wizard's starting point. A guess is checked when it has a column on both sides, or when one
 * kind has no headers at all (repo vs repo, wandb vs wandb); a guess missing one side while that
 * kind is loaded starts unchecked (shown as "not in baseline").
 */
export function initialWizardState(sources: GenerateSources): WizardState {
  const proposed = proposeChoices(sources);
  const hasRepo = headersOf(sources, 'repo').length > 0;
  const hasWandb = headersOf(sources, 'wandb').length > 0;
  const rows = proposed.metrics.map((g) => ({
    ...g,
    include: (g.repo !== null || !hasRepo) && (g.wandb !== null || !hasWandb),
  }));
  const plan = proposed.groups ?? [];
  const defaultNames = new Set(Object.values(proposed.variantGroups ?? {}).flat());
  const variantTables = plan.filter((p) => defaultNames.has(p.name)).map((p) => p.table);
  return {
    rows,
    plan,
    variantsOn: variantTables.length > 0,
    variantTables,
    wandbOnly: proposed.wandbOnly ?? 'unassigned',
  };
}

/** Distinct per-LM variant columns across the rows ("4 LM_2/… columns look like …"). */
export function variantColumns(rows: readonly WizardRow[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.include ? r.variants : [])))];
}

/** A row for a column the matcher left unmatched ("+ add" in the unmatched list). */
export function rowForColumn(
  kind: SourceKind,
  column: string,
  rows: readonly WizardRow[],
): WizardRow {
  const [g] = kind === 'repo' ? matchColumns([column], []) : matchColumns([], [column]);
  const guess: MetricGuess = g ?? {
    key: 'metric',
    label: column,
    direction: 'lower',
    tolerance: 0.1,
    decimals: 2,
    repo: kind === 'repo' ? { column, transforms: [{ kind: 'to_number' }] } : null,
    wandb: kind === 'wandb' ? { column, transforms: [{ kind: 'to_number' }] } : null,
    known: false,
    variants: [],
  };
  const taken = new Set(rows.map((r) => r.key));
  let key = guess.key;
  for (let n = 2; taken.has(key); n++) {
    const suffix = `_${n}`;
    key = guess.key.slice(0, 64 - suffix.length) + suffix;
  }
  return { ...guess, key, include: true };
}

/** Columns of the loaded sources that no row uses. */
export function unmatchedFor(
  sources: GenerateSources,
  rows: readonly WizardRow[],
): { repo: string[]; wandb: string[] } {
  return unmatchedColumns(headersOf(sources, 'repo'), headersOf(sources, 'wandb'), rows);
}

/** Sets one side's column of a row (null = none), keeping its transforms when it had one. */
export function withRowColumn(row: WizardRow, kind: SourceKind, column: string | null): WizardRow {
  const prev = row[kind];
  const spec: ColumnSpec | null =
    column === null
      ? null
      : { column, transforms: prev ? prev.transforms : [{ kind: 'to_number' }] };
  return { ...row, [kind]: spec };
}

export interface TableSummary {
  table: string;
  experiments: number;
  /** Experiments of the table with a row in at least one of the runs. */
  matchedInRuns: number;
}

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

/** Experiment and matched-in-runs counts per baseline table (default matching per kind). */
export function tableSummaries(sources: GenerateSources): TableSummary[] {
  if (sources.baseline.kind !== 'repo') return [];
  const ids = emptyConfig().sources;
  return sources.baseline.tables.map((t) => {
    const names = tableIds(t, ids.repo.id_column);
    let matched = 0;
    for (const name of names) {
      const found = sources.runs.some((run: Source) => {
        const table =
          run.kind === 'wandb' ? run.tables[0] : run.tables.find((x) => x.path === t.path);
        if (!table) return false;
        const kind = ids[run.kind];
        return findRows(table, kind.id_column, name, kind.match).indices.length > 0;
      });
      if (found) matched++;
    }
    return { table: t.path, experiments: names.length, matchedInRuns: matched };
  });
}

/** Per-row error of the step 3 group names (empty, too long, used twice), or null. */
export function planNameErrors(plan: readonly WizardPlan[]): (string | null)[] {
  const counts = new Map<string, number>();
  for (const p of plan) if (p.include) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  return plan.map((p) => {
    if (!p.include) return null;
    if (p.name.trim() === '') return 'A group needs a name';
    if (p.name.length > LIMITS.stringLength) return `At most ${LIMITS.stringLength} characters`;
    if ((counts.get(p.name) ?? 0) > 1) return 'Two groups have this name';
    return null;
  });
}

function guessOf(r: WizardRow): MetricGuess {
  const g: MetricGuess = {
    key: r.key,
    label: r.label,
    direction: r.direction,
    tolerance: r.tolerance,
    decimals: r.decimals,
    repo: r.repo,
    wandb: r.wandb,
    known: r.known,
    variants: r.variants,
  };
  if (r.units !== undefined) g.units = r.units;
  return g;
}

/** The choices `generateConfig` receives; the config is named after the baseline label. */
export function choicesOf(state: WizardState, baseline: Source): GenerateChoices {
  const metrics: MetricGuess[] = state.rows.filter((r) => r.include).map(guessOf);
  const variantGroups: Record<string, string[]> = {};
  if (state.variantsOn) {
    const names = state.plan
      .filter((p) => p.include && state.variantTables.includes(p.table))
      .map((p) => p.name);
    for (const g of metrics)
      if (g.variants.length > 0 && names.length > 0) variantGroups[g.key] = names;
  }
  return {
    name: baseline.label,
    metrics,
    groups:
      state.plan.length > 0 ? state.plan.map((p) => ({ ...p, name: p.name.trim() })) : undefined,
    wandbOnly: state.wandbOnly,
    variantGroups,
  };
}

/** Number of run experiments that would land in the `wandb-only` group. */
export function wandbOnlyCount(sources: GenerateSources, state: WizardState): number {
  const choices = { ...choicesOf(state, sources.baseline), wandbOnly: 'group' as const };
  const withGroup = generateConfig(sources, choices);
  const without = generateConfig(sources, { ...choices, wandbOnly: 'unassigned' });
  if (withGroup.groups.length === without.groups.length) return 0;
  return withGroup.groups.at(-1)?.experiments.length ?? 0;
}

export function buildConfig(sources: GenerateSources, state: WizardState): Config {
  return generateConfig(sources, choicesOf(state, sources.baseline));
}

export { basename as tableBaseName };
