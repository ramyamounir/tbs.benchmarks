import { useMemo } from 'react';
import { compareAll } from '../compare/compare';
import type { Comparison, Config, Source } from '../model/types';
import { filesModel, type FilesModel } from '../views/config/model';
import { isReady, useAppStore } from './store';

/*
 * Derived, memoized reads of the store (spec Phase 3). Store actions replace objects immutably, so
 * reference identity changes exactly when an input changes and the memo is exact.
 */

type CompareInputs = [Config, Source, Source[], Record<string, number>];
let lastCompare: { inputs: CompareInputs; result: Comparison } | null = null;

/**
 * `compareAll` behind a one-entry identity cache shared by every `useComparison` caller, so
 * switching views or opening the Export menu reuses the result instead of recomputing it per
 * component (spec Phase 7 "Performance pass"). Exported for the memoization test.
 */
export function sharedComparison(...inputs: CompareInputs): Comparison {
  if (lastCompare && lastCompare.inputs.every((x, i) => x === inputs[i])) return lastCompare.result;
  const result = compareAll(...inputs);
  lastCompare = { inputs, result };
  return result;
}

/** The comparison of the active config; null while no baseline is loaded. */
export function useComparison(): Comparison | null {
  const config = useAppStore((s) => s.config.active.config);
  const baseline = useAppStore((s) => s.sources.baseline);
  const runs = useAppStore((s) => s.sources.runs);
  const rowChoices = useAppStore((s) => s.session.rowChoices);
  return useMemo(
    () => (baseline === null ? null : sharedComparison(config, baseline, runs, rowChoices)),
    [config, baseline, runs, rowChoices],
  );
}

/** Runs with `hidden === false`, in order. */
export function useVisibleRuns(): Source[] {
  const runs = useAppStore((s) => s.sources.runs);
  return useMemo(() => runs.filter((r) => !r.hidden), [runs]);
}

/** Sum of the experiments of every group of the active config (breadcrumb, headers). */
export function useExperimentCount(): number {
  return useAppStore((s) =>
    s.config.active.config.groups.reduce((n, g) => n + g.experiments.length, 0),
  );
}

/** A baseline and at least one run are loaded (Phase 3 "View rules (store)"). */
export function useReady(): boolean {
  return useAppStore((s) => isReady(s.sources));
}

/** Key of an experiment row in `session.table.expanded` (group name + experiment name). */
export function experimentKey(group: string, experiment: string): string {
  return `${group}\u0000${experiment}`;
}

/** `[baseline, ...runs]` (every run, hidden ones included); `[]` when nothing is loaded. */
export function useLoadedSources(): Source[] {
  const baseline = useAppStore((s) => s.sources.baseline);
  const runs = useAppStore((s) => s.sources.runs);
  return useMemo(() => (baseline ? [baseline, ...runs] : [...runs]), [baseline, runs]);
}

/** The Config view's "From your files" model (Phase 4a), memoized on the config and sources. */
export function useFilesModel(): FilesModel {
  const config = useAppStore((s) => s.config.active.config);
  const sources = useLoadedSources();
  return useMemo(() => filesModel(config, sources), [config, sources]);
}
