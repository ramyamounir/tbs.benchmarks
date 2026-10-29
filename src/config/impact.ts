import { compareMetric } from '../compare/compare';
import type { Config, Source } from '../model/types';

/**
 * The metric editor's live impact line (spec Phase 4b "Impact line"): how many verdicts of one
 * metric change between two definitions of the config. Only that metric's cells are recomputed,
 * with the same inner loop as `compareAll` (`compareMetric`), so the line can never disagree with
 * the Overview and Table. Pure: no DOM, no store.
 */

export interface Impact {
  /** Cells (run × experiment) whose verdict differs. */
  changed: number;
  /** Distinct runs with at least one changed cell. */
  runs: number;
}

export function impactOfChange(
  prevConfig: Config,
  nextConfig: Config,
  metricKey: string,
  baseline: Source,
  runs: Source[],
  rowChoices: Record<string, number>,
): Impact {
  const prev = compareMetric(prevConfig, metricKey, baseline, runs, rowChoices);
  const next = compareMetric(nextConfig, metricKey, baseline, runs, rowChoices);
  let changed = 0;
  let runCount = 0;
  for (const run of runs) {
    const a = Object.hasOwn(prev, run.id) ? prev[run.id] : {};
    const b = Object.hasOwn(next, run.id) ? next[run.id] : {};
    let inRun = 0;
    // A cell present on one side only (the metric was added to / removed from a group) counts too.
    const names = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const name of names) {
      const va = Object.hasOwn(a, name) ? a[name].verdict : undefined;
      const vb = Object.hasOwn(b, name) ? b[name].verdict : undefined;
      if (va !== vb) inRun++;
    }
    changed += inRun;
    if (inRun > 0) runCount++;
  }
  return { changed, runs: runCount };
}

/**
 * "Changes 9 verdicts across 3 runs · was 0.01" / "No verdict changes". `prevTolerance` is the
 * tolerance before the edit, already formatted by the caller (e.g. `0.01` or `1 %`); omitted or
 * null leaves out the "· was …" part.
 */
export function formatImpact(result: Impact, prevTolerance?: string | number | null): string {
  if (result.changed === 0) return 'No verdict changes';
  const was =
    prevTolerance === undefined || prevTolerance === null ? '' : ` · was ${prevTolerance}`;
  const verdicts = `${result.changed} ${result.changed === 1 ? 'verdict' : 'verdicts'}`;
  const runs = `${result.runs} ${result.runs === 1 ? 'run' : 'runs'}`;
  return `Changes ${verdicts} across ${runs}${was}`;
}
