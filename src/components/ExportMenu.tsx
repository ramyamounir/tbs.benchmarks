import { useState, type ReactNode } from 'react';
import { getExportAllCharts } from '../charts/exportAll';
import { renderMarkdown } from '../compare/markdown';
import { useComparison, useReady, useVisibleRuns } from '../state/selectors';
import { useAppStore } from '../state/store';
import { localDateStamp } from '../util/dates';
import { displayName } from '../util/displayName';
import { downloadBlob, MIME, safeFileName } from '../util/download';
import {
  changeCount,
  changelogFileName,
  downloadChangelog,
  downloadWritebackZip,
  useWriteback,
  zipBlocker,
  zipTables,
} from '../views/writeback/model';
import { exportConfig } from './configActions';

interface Entry {
  key: string;
  label: string;
  description: ReactNode;
  /** Why the entry is disabled; null when it is enabled. */
  hint: string | null;
  error?: string | null;
  onSelect(): void;
}

function ExportRow({ entry }: { entry: Entry }) {
  const disabled = entry.hint !== null;
  return (
    <li>
      <button
        type="button"
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) entry.onSelect();
        }}
        className={`flex w-full min-w-0 flex-col items-start rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent ${
          disabled ? 'cursor-not-allowed' : 'hover:bg-row-alt'
        }`}
      >
        <span className={`text-[13px] font-medium ${disabled ? 'text-faint' : 'text-text'}`}>
          {entry.label}
        </span>
        <span className={`text-[11px] ${disabled ? 'text-faint' : 'text-muted'}`}>
          {entry.description}
        </span>
        {disabled && <span className="text-[11px] text-faint">{entry.hint}</span>}
      </button>
      {entry.error != null && (
        <p role="alert" className="px-3 pb-2 text-[12px] text-danger">
          {entry.error}
        </p>
      )}
    </li>
  );
}

/**
 * The top bar's "Export…" menu (spec Phase 6): every export of the app in one place, reusing the
 * same download helpers as the views. The chart entry calls the mounted Charts view's export
 * function and is disabled elsewhere: the modal never switches views or renders charts off-screen.
 */
export function ExportMenu() {
  const config = useAppStore((s) => s.config.active.config);
  const view = useAppStore((s) => s.ui.view);
  const baseline = useAppStore((s) => s.sources.baseline);
  const enabled = useAppStore((s) => s.session.writeback.fileEnabled);
  const closeModal = useAppStore((s) => s.closeModal);
  const ready = useReady();
  const cmp = useComparison();
  const runs = useVisibleRuns();
  const wb = useWriteback();
  const [chartError, setChartError] = useState<string | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);

  const configName = displayName(config.name).text;
  const exportCharts = getExportAllCharts();
  const chartHint =
    view !== 'charts'
      ? 'Open the Charts view to export all charts'
      : config.charts.length === 0
        ? 'No charts to export'
        : exportCharts === null
          ? 'Open the Charts view to export all charts'
          : null;

  const mdHint =
    !ready || !cmp || !baseline
      ? 'Load a baseline and a run first'
      : runs.length === 0
        ? 'Every run is hidden'
        : null;

  const zipHint =
    wb === null
      ? ready
        ? 'Open Write-back and choose a run first'
        : 'Load a baseline and a run first'
      : zipBlocker(wb, enabled);
  const inZip = wb ? zipTables(wb.plan, enabled) : [];
  const cells = inZip.reduce((n, tp) => n + changeCount(tp), 0);

  const entries: Entry[] = [
    {
      key: 'yaml',
      label: 'Config (YAML)',
      description: `${configName}.yaml · v2 config, the default format`,
      hint: null,
      onSelect: () => {
        exportConfig(config, 'yaml');
        closeModal();
      },
    },
    {
      key: 'json',
      label: 'Config (JSON)',
      description: `${configName}.json · the same config as JSON`,
      hint: null,
      onSelect: () => {
        exportConfig(config, 'json');
        closeModal();
      },
    },
    {
      key: 'markdown',
      label: 'Markdown report',
      description: 'Per-experiment tables for every visible run (v1-compatible .md)',
      hint: mdHint,
      onSelect: () => {
        if (!cmp || !baseline) return;
        const text = renderMarkdown(cmp, config, {
          baselineLabel: baseline.label,
          runLabels: runs.map((r) => r.label),
          runIds: runs.map((r) => r.id),
        });
        downloadBlob(
          safeFileName(`benchmarks-${config.name}-${localDateStamp()}.md`),
          new Blob([text], { type: MIME.markdown }),
        );
        closeModal();
      },
    },
    {
      key: 'charts',
      label: 'All charts (PNG zip)',
      description:
        config.charts.length === 1
          ? 'The chart as a PNG image'
          : `${config.charts.length} charts as PNG images in a zip`,
      hint: chartHint,
      error: chartError,
      onSelect: () => {
        const fn = getExportAllCharts();
        if (!fn) return;
        setChartError(null);
        fn().then(
          () => closeModal(),
          (e: unknown) =>
            setChartError(e instanceof Error ? e.message : 'Could not export the charts'),
        );
      },
    },
    {
      key: 'writeback',
      label: 'Write-back zip',
      description: wb
        ? `${inZip.length} ${inZip.length === 1 ? 'file' : 'files'} · ${cells} ${cells === 1 ? 'cell' : 'cells'} from ${displayName(wb.run.label).text} · extract at your clone root`
        : 'Updated benchmarks/*.csv files to extract at your clone root',
      hint: zipHint,
      error: zipError,
      onSelect: () => {
        if (!wb) return;
        const err = downloadWritebackZip(wb, enabled);
        setZipError(err);
        if (err === null) closeModal();
      },
    },
    {
      key: 'changelog',
      label: 'Change log (.txt)',
      description: wb
        ? `${changelogFileName(wb.run)} · every write-back change and skip`
        : 'Every write-back change and skip as text',
      hint: wb === null ? 'Open Write-back and choose a run first' : null,
      onSelect: () => {
        if (!wb) return;
        downloadChangelog(wb);
        closeModal();
      },
    },
  ];

  return (
    <ul className="-mx-3 flex flex-col gap-0.5">
      {entries.map((e) => (
        <ExportRow key={e.key} entry={e} />
      ))}
    </ul>
  );
}
