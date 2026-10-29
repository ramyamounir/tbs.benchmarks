import { groupTable, missingExperiments, unassignedExperiments } from '../compare/compare';
import type { Config, ConfigIssue, Source, SourceKind } from '../model/types';
import { validateConfig } from './schema';

/**
 * The loaded sources `configIssues` checks against: either `{ baseline, runs }` or a plain list
 * whose first entry is the baseline (`[]` = nothing loaded).
 */
export type IssueSources = readonly Source[] | { baseline: Source | null; runs: readonly Source[] };

function split(sources: IssueSources): { baseline: Source | null; runs: readonly Source[] } {
  if (Array.isArray(sources)) {
    const list = sources as readonly Source[];
    return { baseline: list[0] ?? null, runs: list.slice(1) };
  }
  return sources as { baseline: Source | null; runs: readonly Source[] };
}

/**
 * Every issue of a config against the loaded sources (spec Phase 2b "Validation issues"), so the
 * UI can list them and jump to their target. Includes the structural codes of `validateConfig`
 * (on a validated config those are only `regex-invalid` and `chart-*-unknown`). Never throws.
 */
export function configIssues(config: Config, sources: IssueSources): ConfigIssue[] {
  const issues: ConfigIssue[] = [...validateConfig(config).issues];
  const { baseline, runs } = split(sources);
  const loaded = baseline ? [baseline, ...runs] : [...runs];

  // Metric references.
  for (const g of config.groups) {
    for (const key of new Set(g.metrics)) {
      if (!Object.hasOwn(config.metrics, key)) {
        issues.push({
          code: 'metric-unknown',
          severity: 'error',
          message: `groups.${g.name}: unknown metric "${key}"`,
          target: { kind: 'group', id: g.name },
        });
      }
    }
    if (g.experiments.length === 0) {
      issues.push({
        code: 'group-empty',
        severity: 'warning',
        message: `groups.${g.name}: no experiments`,
        target: { kind: 'group', id: g.name },
      });
    }
  }

  // An experiment in two groups.
  const firstGroup = new Map<string, string>();
  const reported = new Set<string>();
  for (const g of config.groups) {
    for (const name of new Set(g.experiments)) {
      const first = firstGroup.get(name);
      if (first === undefined) firstGroup.set(name, g.name);
      else if (first !== g.name && !reported.has(name)) {
        reported.add(name);
        issues.push({
          code: 'experiment-duplicate',
          severity: 'error',
          message: `experiment "${name}" is in groups "${first}" and "${g.name}"`,
          target: { kind: 'experiment', id: name },
        });
      }
    }
  }

  // Metrics no group uses.
  const used = new Set(config.groups.flatMap((g) => g.metrics));
  for (const key of Object.keys(config.metrics)) {
    if (!used.has(key)) {
      issues.push({
        code: 'metric-unused',
        severity: 'warning',
        message: `metrics.${key}: not used by any group`,
        target: { kind: 'metric', id: key },
      });
    }
  }

  // Source-dependent checks.
  for (const source of loaded) {
    const isBaseline = source === baseline;
    for (const g of config.groups) {
      const table = groupTable(g, source);
      if (table === null) {
        // Only a repo source can miss its table (a wandb source always reads its export), so a
        // `null` table with no repo source loaded is never reported.
        issues.push({
          code: 'table-missing',
          severity: isBaseline ? 'error' : 'warning',
          message:
            g.table === null
              ? `groups.${g.name}: no table set for the ${isBaseline ? 'baseline' : 'run'} "${source.label}"`
              : `groups.${g.name}: table "${g.table}" not found in ${isBaseline ? 'the baseline' : 'run'} "${source.label}"`,
          target: { kind: 'group', id: g.name },
        });
        continue;
      }
      const header = new Set(table.csv.header);
      for (const key of new Set(g.metrics)) {
        if (!Object.hasOwn(config.metrics, key)) continue;
        const metric = config.metrics[key];
        const spec = Object.hasOwn(metric.columns, source.kind)
          ? metric.columns[source.kind]
          : undefined;
        if (!spec) continue; // reported once per kind as source-kind-unmapped below
        let column = spec.column;
        if (Object.hasOwn(g.column_overrides, key)) {
          const o = g.column_overrides[key];
          if (Object.hasOwn(o, source.kind) && typeof o[source.kind] === 'string')
            column = o[source.kind] as string;
        }
        if (!header.has(column)) {
          issues.push({
            code: 'column-missing',
            severity: 'error',
            message: `groups.${g.name}: column "${column}" of metric "${key}" not found in "${table.path}" of "${source.label}"`,
            target: { kind: 'metric', id: key },
          });
        }
      }
    }
  }

  // A loaded kind without a column for a metric some group uses.
  const kinds = new Set<SourceKind>(loaded.map((s) => s.kind));
  for (const key of Object.keys(config.metrics)) {
    if (!used.has(key)) continue;
    for (const kind of kinds) {
      if (!Object.hasOwn(config.metrics[key].columns, kind)) {
        issues.push({
          code: 'source-kind-unmapped',
          severity: 'warning',
          message: `metrics.${key}: no ${kind} column; ${kind} sources show it as missing`,
          target: { kind: 'metric', id: key },
        });
      }
    }
  }

  if (baseline) {
    // Experiments in the config with no baseline row (groups whose table is missing are already
    // reported as table-missing).
    for (const m of missingExperiments(config, baseline)) {
      const g = config.groups.find((x) => x.name === m.group);
      if (g && groupTable(g, baseline) === null) continue;
      for (const name of m.names) {
        issues.push({
          code: 'experiment-not-in-baseline',
          severity: 'warning',
          message: `groups.${m.group}: experiment "${name}" has no row in the baseline`,
          target: { kind: 'experiment', id: name },
        });
      }
    }
  }

  if (loaded.length > 0) {
    const names = new Set<string>();
    for (const u of unassignedExperiments(config, loaded)) for (const n of u.names) names.add(n);
    if (names.size > 0) {
      issues.push({
        code: 'experiments-unassigned',
        severity: 'warning',
        message: `${names.size} experiment${names.size === 1 ? '' : 's'} in the loaded files ${names.size === 1 ? 'is' : 'are'} not in any group`,
      });
    }
  }

  return issues;
}

/** True when the list has no error-severity issue. */
export function isValid(issues: readonly ConfigIssue[]): boolean {
  return !issues.some((i) => i.severity === 'error');
}
