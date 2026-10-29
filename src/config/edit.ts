import type { Config, Group } from '../model/types';
import { isValidMetricKey, LIMITS } from './schema';

/**
 * Reference-safe renames and deletes (spec Phase 2b "Reference-safe edits"): the only way the app
 * renames or deletes a metric or group, so no reference (group metric lists, `column_overrides`,
 * saved charts) is ever left dangling. Each helper returns a new Config (changed parts rebuilt,
 * unchanged parts shared), never mutates its input and never throws; a refused edit (failed
 * precondition) returns the very same `config` reference, so callers can test with `===`.
 */

/** A copy of `obj` with key `from` replaced by `to` in the same position. */
function renameKey<T>(obj: Record<string, T>, from: string, to: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj)) out[k === from ? to : k] = obj[k];
  return out;
}

/** A copy of `obj` without key `drop`. */
function withoutKey<T>(obj: Record<string, T>, drop: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj)) if (k !== drop) out[k] = obj[k];
  return out;
}

export function renameMetric(config: Config, oldKey: string, newKey: string): Config {
  try {
    if (
      !Object.hasOwn(config.metrics, oldKey) ||
      !isValidMetricKey(newKey) ||
      newKey === oldKey ||
      Object.hasOwn(config.metrics, newKey)
    )
      return config;
    const groups = config.groups.map((g): Group => {
      const listed = g.metrics.includes(oldKey);
      const overridden = Object.hasOwn(g.column_overrides, oldKey);
      if (!listed && !overridden) return g;
      return {
        ...g,
        metrics: listed ? g.metrics.map((k) => (k === oldKey ? newKey : k)) : g.metrics,
        column_overrides: overridden
          ? renameKey(g.column_overrides, oldKey, newKey)
          : g.column_overrides,
      };
    });
    const charts = config.charts.map((c) => (c.metric === oldKey ? { ...c, metric: newKey } : c));
    return { ...config, metrics: renameKey(config.metrics, oldKey, newKey), groups, charts };
  } catch {
    return config;
  }
}

export function deleteMetric(config: Config, key: string): Config {
  try {
    if (!Object.hasOwn(config.metrics, key)) return config;
    const groups = config.groups.map((g): Group => {
      const listed = g.metrics.includes(key);
      const overridden = Object.hasOwn(g.column_overrides, key);
      if (!listed && !overridden) return g;
      return {
        ...g,
        metrics: listed ? g.metrics.filter((k) => k !== key) : g.metrics,
        column_overrides: overridden ? withoutKey(g.column_overrides, key) : g.column_overrides,
      };
    });
    // A chart without its metric has nothing to show: it goes with the metric.
    const charts = config.charts.filter((c) => c.metric !== key);
    return { ...config, metrics: withoutKey(config.metrics, key), groups, charts };
  } catch {
    return config;
  }
}

export function renameGroup(config: Config, oldName: string, newName: string): Config {
  try {
    const i = config.groups.findIndex((g) => g.name === oldName);
    if (
      i < 0 ||
      newName.trim() === '' ||
      newName.length > LIMITS.stringLength ||
      newName === oldName ||
      config.groups.some((g) => g.name === newName)
    )
      return config;
    const groups = config.groups.map((g, j) => (j === i ? { ...g, name: newName } : g));
    // Charts follow the renamed group unless another group still carries the old name.
    const stillThere = groups.some((g) => g.name === oldName);
    const charts = stillThere
      ? config.charts
      : config.charts.map((c) => (c.group === oldName ? { ...c, group: newName } : c));
    return { ...config, groups, charts };
  } catch {
    return config;
  }
}

export function deleteGroup(config: Config, name: string): Config {
  try {
    const i = config.groups.findIndex((g) => g.name === name);
    if (i < 0) return config;
    const groups = config.groups.filter((_, j) => j !== i);
    const charts = groups.some((g) => g.name === name)
      ? config.charts
      : config.charts.filter((c) => c.group !== name);
    // Metrics are kept: an unused metric is only the `metric-unused` warning.
    return { ...config, groups, charts };
  } catch {
    return config;
  }
}
