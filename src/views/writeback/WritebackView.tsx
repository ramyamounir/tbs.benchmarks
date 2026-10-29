import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { CopyFallback } from '../../components/ui/CopyFallback';
import { useAppStore } from '../../state/store';
import { copyText } from '../../util/clipboard';
import { DisplayName } from '../../util/DisplayName';
import { formatChangelog } from '../../writeback/changelog';
import type { WritebackTablePlan } from '../../writeback/plan';
import {
  changeCount,
  downloadTableFile,
  downloadWritebackZip,
  fileEnabled,
  useWriteback,
  zipBlocker,
  zipTables,
} from './model';
import { TableCard } from './TableCard';

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
    </svg>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Write-back (spec Phase 6, `reference/05-writeback.png`): the cells the selected run would write
 * into each baseline table, with per-cell keep toggles, per-file download, the zip and the log.
 */
export function WritebackView() {
  const runs = useAppStore((s) => s.sources.runs);
  const runId = useAppStore((s) => s.session.writeback.runId);
  const enabled = useAppStore((s) => s.session.writeback.fileEnabled);
  const setSession = useAppStore((s) => s.setSession);
  const toggleKept = useAppStore((s) => s.toggleKept);
  const pushToast = useAppStore((s) => s.pushToast);
  const m = useWriteback();
  const [fallback, setFallback] = useState<{ text: string; label: string } | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  // The first run is the default source of values; the choice is kept in the session.
  useEffect(() => {
    if ((runId === null || !runs.some((r) => r.id === runId)) && runs.length > 0) {
      setSession({ writeback: { runId: runs[0].id } });
    }
  }, [runId, runs, setSession]);

  // The first table with changes starts expanded; the others collapsed (toggled per path).
  const firstChanged = useMemo(
    () => m?.plan.tables.find((t) => changeCount(t) > 0)?.path ?? null,
    [m],
  );
  const isOpen = (path: string) =>
    Object.hasOwn(toggled, path) ? toggled[path] : path === firstChanged;

  const onToggleOpen = useCallback(
    (path: string) =>
      setToggled((t) => ({
        ...t,
        [path]: !(Object.hasOwn(t, path) ? t[path] : path === firstChanged),
      })),
    [firstChanged],
  );
  const onToggleEnabled = useCallback(
    (path: string, on: boolean) => {
      const cur = useAppStore.getState().session.writeback.fileEnabled;
      setSession({ writeback: { fileEnabled: { ...cur, [path]: on } } });
    },
    [setSession],
  );
  const copy = useCallback(
    async (text: string, label: string, done: string) => {
      setFallback(null);
      if (await copyText(text)) pushToast('info', done);
      else setFallback({ text, label });
    },
    [pushToast],
  );
  const runIdOf = m?.run.id;
  const onCopyLog = useCallback(
    (tp: WritebackTablePlan) => {
      if (runIdOf === undefined) return;
      void copy(
        formatChangelog({ runId: runIdOf, tables: [tp] }),
        'Change log',
        'Copied the file’s change log',
      );
    },
    [copy, runIdOf],
  );

  if (!m) return null;
  const { baseline, run, plan } = m;
  const inZip = zipTables(plan, enabled);
  const cells = inZip.reduce((n, tp) => n + changeCount(tp), 0);
  const blocker = zipBlocker(m, enabled);
  const allChanges = plan.tables.reduce((n, tp) => n + changeCount(tp), 0);
  const log = formatChangelog(plan);

  const downloadZip = () => {
    setZipError(downloadWritebackZip(m, enabled));
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 mid:p-6">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-[17px] font-semibold text-text">
          Write-back
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 font-mono text-[12px] font-normal text-muted">
            <DisplayName value={run.label} />
            <span aria-hidden="true">→</span>
            <span className="sr-only">into</span>
            <DisplayName value={baseline.label} />
            <span>
              · {plural(inZip.length, 'file', 'files')} · {plural(cells, 'cell', 'cells')}
            </span>
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void copy(log, 'Change log', 'Copied the change log')}
            disabled={log === ''}
          >
            <CopyIcon />
            Copy change log
          </Button>
          <Button
            variant="primary"
            onClick={downloadZip}
            disabled={blocker !== null}
            title={blocker ?? undefined}
            aria-describedby={blocker !== null ? 'wb-zip-reason' : undefined}
          >
            <DownloadIcon />
            Download {plural(inZip.length, 'file', 'files')} (.zip)
          </Button>
        </div>
      </header>
      {blocker !== null && allChanges > 0 && (
        <p id="wb-zip-reason" className="-mt-2 text-right text-[11px] text-muted">
          {blocker}
        </p>
      )}
      {zipError !== null && (
        <p role="alert" className="text-[12px] text-danger">
          {zipError}
        </p>
      )}
      {fallback !== null && (
        <CopyFallback
          text={fallback.text}
          label={fallback.label}
          onClose={() => setFallback(null)}
        />
      )}

      {plan.tables.length === 0 ? (
        <p className="text-[13px] text-muted">
          No baseline table is read by a valid group of this config, so nothing can be written.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {plan.tables.map((tp) => (
            <TableCard
              key={tp.path}
              tp={tp}
              runId={run.id}
              runLabel={run.label}
              open={isOpen(tp.path)}
              enabled={fileEnabled(enabled, tp.path)}
              onToggleOpen={onToggleOpen}
              onToggleEnabled={onToggleEnabled}
              onToggleKept={toggleKept}
              onDownload={downloadTableFile}
              onCopyLog={onCopyLog}
            />
          ))}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">Change log</h3>
        <pre className="max-h-[260px] min-h-[80px] overflow-auto rounded-lg border border-border bg-panel p-3 font-mono text-[11px] whitespace-pre text-text">
          {log === '' ? <span className="text-faint">No changes.</span> : log}
        </pre>
      </section>
    </div>
  );
}
