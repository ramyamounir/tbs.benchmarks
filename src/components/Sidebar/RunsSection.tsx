import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { Source } from '../../model/types';
import { openPicker } from '../../sources/drop';
import { useAppStore } from '../../state/store';
import { formatSourceDate } from '../../util/dates';
import { displayName } from '../../util/displayName';
import { DisplayName } from '../../util/DisplayName';
import { runBg } from '../runColor';
import { LoadStatus } from './LoadStatus';
import { SidebarSection } from './SidebarSection';

const RUN_MIME = 'application/x-tbp-run';

function rowCount(s: Source): number {
  return s.tables.reduce((n, t) => n + t.csv.rows.length, 0);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function GitIcon() {
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
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7M18 11.5c0 3-4 3.5-10 5" />
    </svg>
  );
}

function FileIcon() {
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
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

const iconButton =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-row-alt hover:text-text focus-visible:outline-2 focus-visible:outline-accent';
const hoverOnly = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100';

/** "7 tables · 41 exps · 4f2a9c1" */
function baselineSummary(s: Source): string {
  const parts = [plural(s.tables.length, 'table', 'tables'), `${rowCount(s)} exps`];
  if (s.meta) parts.push(s.meta.sha.slice(0, 7));
  return parts.join(' · ');
}

/** "wandb · 28 runs · Sep 10" */
function runSummary(s: Source): string {
  const n = rowCount(s);
  const rows = s.kind === 'wandb' ? plural(n, 'run', 'runs') : `${n} exps`;
  return [s.kind, rows, formatSourceDate(s.date)].join(' · ');
}

export function BaselineCard() {
  const baseline = useAppStore((s) => s.sources.baseline);
  const remove = useAppStore((s) => s.removeSource);
  if (baseline === null) {
    return (
      <div
        data-drop-role="baseline"
        className="rounded-lg border border-dashed border-border bg-row-alt px-3 py-2.5"
      >
        <div className="text-[13px] font-medium text-text">Baseline</div>
        <div className="text-[11px] text-muted">tbp.monty folder, GitHub ref or CSV</div>
      </div>
    );
  }
  return (
    <div
      data-drop-role="baseline"
      className="group rounded-lg border border-border bg-panel px-3 py-2.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-muted">
          {baseline.origin === 'github' ? <GitIcon /> : <FileIcon />}
        </span>
        <DisplayName
          value={baseline.label}
          className="flex-1 font-mono text-[13px] font-semibold text-text"
        />
        <button
          type="button"
          className={`${iconButton} ${hoverOnly}`}
          aria-label={`Remove baseline ${displayName(baseline.label).full}`}
          title="Remove baseline"
          onClick={() => remove(baseline.id)}
        >
          ×
        </button>
        <span className="shrink-0 rounded bg-row-alt px-1.5 py-px text-[10px] font-semibold text-muted">
          BASE
        </span>
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-muted">{baselineSummary(baseline)}</div>
    </div>
  );
}

function RunRow({
  run,
  index,
  onMove,
  dragging,
  setDragging,
  handleRef,
}: {
  run: Source;
  index: number;
  onMove(id: string, to: number): void;
  dragging: string | null;
  setDragging(id: string | null): void;
  handleRef(el: HTMLButtonElement | null): void;
}) {
  const toggleHidden = useAppStore((s) => s.toggleRunHidden);
  const remove = useAppStore((s) => s.removeSource);
  const setBaseline = useAppStore((s) => s.setBaseline);
  const [over, setOver] = useState(false);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      onMove(run.id, index + (e.key === 'ArrowUp' ? -1 : 1));
    }
  };
  const accepts = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(RUN_MIME);

  return (
    <li
      className={`group relative flex min-w-0 items-center gap-1.5 rounded-md py-1.5 pr-1 ${over ? 'bg-accent-bg' : ''} ${
        dragging === run.id ? 'opacity-50' : ''
      }`}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const id = e.dataTransfer.getData(RUN_MIME);
        if (id) onMove(id, index);
      }}
    >
      <button
        ref={handleRef}
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(RUN_MIME, run.id);
          e.dataTransfer.effectAllowed = 'move';
          setDragging(run.id);
        }}
        onDragEnd={() => setDragging(null)}
        onKeyDown={onKeyDown}
        aria-label="Reorder run (arrow up / down)"
        title="Drag or use ↑/↓ to reorder"
        className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded text-[12px] text-faint hover:text-muted focus-visible:outline-2 focus-visible:outline-accent"
      >
        ⠿
      </button>
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${runBg(index)} ${run.hidden ? 'opacity-40' : ''}`}
      />
      <span className={`flex min-w-0 flex-1 flex-col ${run.hidden ? 'opacity-60' : ''}`}>
        <DisplayName value={run.label} className="font-mono text-[13px] text-text" />
        <span className="truncate text-[11px] text-muted">{runSummary(run)}</span>
      </span>
      {/* Overlaid on hover/focus so the summary keeps its full width; still Tab-reachable. */}
      <span
        className={`absolute top-1/2 right-8 flex -translate-y-1/2 items-center gap-0.5 rounded bg-panel ${hoverOnly}`}
      >
        <button
          type="button"
          className={`${iconButton} w-auto px-1 text-[10px] font-semibold`}
          title="Use as baseline (swap roles)"
          aria-label={`Use ${displayName(run.label).full} as baseline`}
          onClick={() => setBaseline(run.id)}
        >
          BASE
        </button>
        <button
          type="button"
          className={iconButton}
          title="Remove run"
          aria-label={`Remove ${displayName(run.label).full}`}
          onClick={() => remove(run.id)}
        >
          ×
        </button>
      </span>
      <button
        type="button"
        className={iconButton}
        aria-pressed={!run.hidden}
        aria-label={`${run.hidden ? 'Show' : 'Hide'} ${displayName(run.label).full}`}
        title={run.hidden ? 'Show run' : 'Hide run'}
        onClick={() => toggleHidden(run.id)}
      >
        <EyeIcon off={run.hidden} />
      </button>
    </li>
  );
}

/** Drop-zone row of the Runs section: pickers for runs and the GitHub run modal. */
function RunDropRow() {
  const openModal = useAppStore((s) => s.openModal);
  return (
    <div
      data-drop-role="run"
      className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[12px]"
    >
      <button
        type="button"
        className="min-w-0 truncate text-left text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => openPicker('run', false)}
        title="Choose CSV files to add as runs, or drop CSVs or a folder here"
      >
        + Drop CSVs or a folder
      </button>
      <button
        type="button"
        className="shrink-0 font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => openModal({ kind: 'github', role: 'run' })}
      >
        GitHub…
      </button>
    </div>
  );
}

/**
 * RUNS section shared by Overview, Table, Write-back and the Start screen: the baseline card (a
 * baseline drop target), the ordered runs (drag or ↑/↓ to reorder, eye toggle, remove), the run drop
 * row, load progress and errors.
 */
export function RunsSection() {
  const baseline = useAppStore((s) => s.sources.baseline);
  const runs = useAppStore((s) => s.sources.runs);
  const reorder = useAppStore((s) => s.reorderRuns);
  const [dragging, setDragging] = useState<string | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());

  const onMove = (id: string, to: number) => {
    const from = runs.findIndex((r) => r.id === id);
    if (from < 0 || to < 0 || to >= runs.length || to === from) return;
    const ids = runs.map((r) => r.id);
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    reorder(ids);
    requestAnimationFrame(() => handles.current.get(id)?.focus());
  };

  const aside =
    baseline || runs.length > 0
      ? `${baseline ? 1 : 0} baseline · ${plural(runs.length, 'run', 'runs')}`
      : undefined;

  return (
    <SidebarSection title="Runs" aside={aside}>
      <div className="flex flex-col gap-2" data-drop-role="run">
        <BaselineCard />
        {runs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-row-alt px-3 py-2.5">
            <div className="text-[13px] font-medium text-text">Runs to compare</div>
            <div className="text-[11px] text-muted">wandb CSV exports or folders</div>
          </div>
        ) : (
          <ol aria-label="Runs" className="flex flex-col">
            {runs.map((r, i) => (
              <RunRow
                key={r.id}
                run={r}
                index={i}
                onMove={onMove}
                dragging={dragging}
                setDragging={setDragging}
                handleRef={(el) => {
                  if (el) handles.current.set(r.id, el);
                  else handles.current.delete(r.id);
                }}
              />
            ))}
          </ol>
        )}
        <RunDropRow />
      </div>
      <LoadStatus />
    </SidebarSection>
  );
}
