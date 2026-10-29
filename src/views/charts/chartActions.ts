import { LIMITS } from '../../config/schema';
import type { ChartDef, Config, Group } from '../../model/types';

/*
 * Pure edits of `config.charts` for the Charts view (spec Phase 5b). Chart definitions live in the
 * config (so they export with it); the view applies these through `updateConfig`. Ids follow the
 * Phase 2b "Chart ids" rule: `c<n>` with the smallest free n.
 */

export const DEFAULT_OPTIONS: ChartDef['options'] = {
  toleranceBand: true,
  deltaLabels: true,
  yFromZero: true,
};

export function newChartId(charts: ChartDef[]): string {
  const used = new Set(charts.map((c) => c.id));
  let n = 1;
  while (used.has(`c${n}`)) n++;
  return `c${n}`;
}

export function canAddChart(config: Config): boolean {
  return config.charts.length < LIMITS.charts;
}

/** The chart's metric when the group compares it, else the group's first known metric. */
export function metricForGroup(config: Config, group: Group, current: string): string {
  if (group.metrics.includes(current) && Object.hasOwn(config.metrics, current)) return current;
  return group.metrics.find((k) => Object.hasOwn(config.metrics, k)) ?? current;
}

/**
 * A new grouped-bars chart appended to the config: on `template`'s metric and group when given
 * (the selected chart), else the first group and its first metric. Null when nothing can be charted
 * (no group or no metric) or the chart limit is reached.
 */
export function addChart(
  config: Config,
  template?: Pick<ChartDef, 'metric' | 'group'>,
): { config: Config; id: string } | null {
  if (!canAddChart(config)) return null;
  const group =
    (template && config.groups.find((g) => g.name === template.group)) ?? config.groups[0];
  if (!group) return null;
  const firstMetric = Object.keys(config.metrics)[0];
  const metric = metricForGroup(config, group, template?.metric ?? firstMetric ?? '');
  if (!Object.hasOwn(config.metrics, metric)) return null;
  const id = newChartId(config.charts);
  const chart: ChartDef = {
    id,
    type: 'grouped_bars',
    metric,
    group: group.name,
    experiments: null,
    options: { ...DEFAULT_OPTIONS },
  };
  return { config: { ...config, charts: [...config.charts, chart] }, id };
}

/** A copy of chart `id` (new id) inserted right after it. */
export function duplicateChart(config: Config, id: string): { config: Config; id: string } | null {
  const i = config.charts.findIndex((c) => c.id === id);
  if (i < 0 || !canAddChart(config)) return null;
  const src = config.charts[i];
  const copy: ChartDef = {
    ...src,
    id: newChartId(config.charts),
    experiments: src.experiments === null ? null : [...src.experiments],
    options: { ...src.options },
  };
  const charts = [...config.charts];
  charts.splice(i + 1, 0, copy);
  return { config: { ...config, charts }, id: copy.id };
}

export function deleteChart(config: Config, id: string): Config {
  return { ...config, charts: config.charts.filter((c) => c.id !== id) };
}

export function moveChart(config: Config, id: string, delta: -1 | 1): Config {
  const i = config.charts.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= config.charts.length) return config;
  const charts = [...config.charts];
  [charts[i], charts[j]] = [charts[j], charts[i]];
  return { ...config, charts };
}

export function updateChart(
  config: Config,
  id: string,
  patch: Partial<Omit<ChartDef, 'id'>>,
): Config {
  return {
    ...config,
    charts: config.charts.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
}

/** Experiments of `chart` that are selected (all of its group when `experiments` is null). */
export function selectedExperiments(chart: ChartDef, group: Group | undefined): Set<string> {
  if (!group || group.name !== chart.group) return new Set();
  return new Set(chart.experiments === null ? group.experiments : chart.experiments);
}

/**
 * Toggle one experiment in the sidebar tree. A chart shows one group: checking an experiment of
 * another group moves the chart to that group with just that experiment. A selection that covers
 * the whole group is stored as `null` ("every experiment of the group").
 */
export function toggleExperiment(
  config: Config,
  chart: ChartDef,
  group: Group,
  name: string,
  checked: boolean,
): Partial<ChartDef> {
  if (group.name !== chart.group) {
    if (!checked) return {};
    return {
      group: group.name,
      metric: metricForGroup(config, group, chart.metric),
      experiments: normalizeSelection(group, [name]),
    };
  }
  const sel = selectedExperiments(chart, group);
  if (checked) sel.add(name);
  else sel.delete(name);
  return { experiments: normalizeSelection(group, [...sel]) };
}

/** Group checkbox: all of the group (and move the chart there) or none of it. */
export function toggleGroup(
  config: Config,
  chart: ChartDef,
  group: Group,
  checked: boolean,
): Partial<ChartDef> {
  if (!checked) return group.name === chart.group ? { experiments: [] } : {};
  return group.name === chart.group
    ? { experiments: null }
    : { group: group.name, metric: metricForGroup(config, group, chart.metric), experiments: null };
}

/** Selection in group order; the whole group → null. */
export function normalizeSelection(group: Group, names: string[]): string[] | null {
  const set = new Set(names);
  const ordered = [...new Set(group.experiments)].filter((n) => set.has(n));
  return ordered.length === new Set(group.experiments).size && ordered.length > 0 ? null : ordered;
}

/**
 * "Chart this experiment →" (Table): select an existing grouped-bars chart of that group showing
 * exactly that experiment, else create one (on the group's first metric). Null when the group is
 * unknown or no chart can be added.
 */
export function chartForExperiment(
  config: Config,
  groupName: string,
  experiment: string,
): { config: Config; id: string } | null {
  const group = config.groups.find((g) => g.name === groupName);
  if (!group) return null;
  const experiments = normalizeSelection(group, [experiment]);
  const same = (a: string[] | null, b: string[] | null) =>
    a === null || b === null ? a === b : a.length === b.length && a.every((x, i) => x === b[i]);
  const existing = config.charts.find(
    (c) => c.type === 'grouped_bars' && c.group === groupName && same(c.experiments, experiments),
  );
  if (existing) return { config, id: existing.id };
  const added = addChart(config, { group: groupName, metric: group.metrics[0] ?? '' });
  if (!added) return null;
  return {
    config: updateChart(added.config, added.id, { experiments }),
    id: added.id,
  };
}

/** The selected chart id, defaulting to the first chart (the inspector always has a target). */
export function effectiveSelected(config: Config, selected: string | null): string | null {
  if (selected !== null && config.charts.some((c) => c.id === selected)) return selected;
  return config.charts[0]?.id ?? null;
}
