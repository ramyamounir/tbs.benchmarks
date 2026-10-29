import { useMemo } from 'react';
import { rewriteRows } from '../../csv/write';
import type { Source } from '../../model/types';
import { useComparison } from '../../state/selectors';
import { useAppStore } from '../../state/store';
import { localDateStamp } from '../../util/dates';
import { downloadBlob, MIME, safeFileName } from '../../util/download';
import { formatChangelog } from '../../writeback/changelog';
import {
  planWriteback,
  tableChanges,
  type WritebackPlan,
  type WritebackTablePlan,
} from '../../writeback/plan';
import { isSafeEntryName, zipStore } from '../../writeback/zip';

/*
 * Write-back state and downloads (spec Phase 6 "Download"), shared by the Write-back view and the
 * Export menu. Every file text reaches a download only through `rewriteRows`; every name goes
 * through `safeFileName`; zip entries are exactly the baseline tables' `Table.path`.
 */

export interface WritebackModel {
  baseline: Source;
  run: Source;
  plan: WritebackPlan;
}

/** The plan for the selected write-back run; null when no baseline or no (existing) run is selected. */
export function useWriteback(): WritebackModel | null {
  const cmp = useComparison();
  const config = useAppStore((s) => s.config.active.config);
  const baseline = useAppStore((s) => s.sources.baseline);
  const runs = useAppStore((s) => s.sources.runs);
  const wb = useAppStore((s) => s.session.writeback);
  const run = runs.find((r) => r.id === wb.runId) ?? null;
  const { keepFormatting, skipWithinTol, skipEpisodeMismatch, kept } = wb;
  return useMemo(() => {
    if (!cmp || !baseline || !run) return null;
    const plan = planWriteback(cmp, config, baseline, run, {
      keepFormatting,
      skipWithinTol,
      skipEpisodeMismatch,
      kept,
    });
    return { baseline, run, plan };
  }, [cmp, config, baseline, run, keepFormatting, skipWithinTol, skipEpisodeMismatch, kept]);
}

export const changeCount = (tp: WritebackTablePlan): number =>
  tp.entries.filter((e) => e.skipped === undefined).length;

/** A table path that may be used as a zip entry name (the zip is extracted at the clone root). */
export const zippable = (tp: WritebackTablePlan): boolean => isSafeEntryName(tp.path);

export const fileEnabled = (enabled: Record<string, boolean>, path: string): boolean =>
  !Object.hasOwn(enabled, path) || enabled[path] !== false;

/** Tables that go into the zip: enabled, zippable, with at least one non-skipped change. */
export function zipTables(
  plan: WritebackPlan,
  enabled: Record<string, boolean>,
): WritebackTablePlan[] {
  return plan.tables.filter(
    (tp) => fileEnabled(enabled, tp.path) && zippable(tp) && changeCount(tp) > 0,
  );
}

/** Why the zip cannot be downloaded, or null when it can. */
export function zipBlocker(m: WritebackModel, enabled: Record<string, boolean>): string | null {
  if (m.baseline.kind !== 'repo') {
    return 'The baseline is not a benchmarks folder: download single files instead';
  }
  if (zipTables(m.plan, enabled).length === 0) return 'No file with changes is selected';
  return null;
}

export function rewrittenText(tp: WritebackTablePlan): string {
  return rewriteRows(tp.table.csv, tableChanges(tp));
}

const lastSegment = (path: string): string => path.split('/').pop() ?? path;

export function downloadTableFile(tp: WritebackTablePlan): void {
  downloadBlob(
    safeFileName(lastSegment(tp.path)),
    new Blob([rewrittenText(tp)], { type: MIME.csv }),
  );
}

/** Downloads the zip; resolves to an error message instead of throwing. */
export function downloadWritebackZip(
  m: WritebackModel,
  enabled: Record<string, boolean>,
): string | null {
  const blocker = zipBlocker(m, enabled);
  if (blocker !== null) return blocker;
  try {
    const encoder = new TextEncoder();
    const blob = zipStore(
      zipTables(m.plan, enabled).map((tp) => ({
        name: tp.path,
        data: encoder.encode(rewrittenText(tp)),
      })),
    );
    downloadBlob(safeFileName(`benchmarks-writeback-${m.run.label}-${localDateStamp()}.zip`), blob);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not build the zip';
  }
}

export function changelogFileName(run: Source): string {
  return safeFileName(`writeback-changelog-${run.label}-${localDateStamp()}.txt`);
}

export function downloadChangelog(m: WritebackModel): void {
  const text = formatChangelog(m.plan);
  downloadBlob(changelogFileName(m.run), new Blob([text], { type: MIME.text }));
}
