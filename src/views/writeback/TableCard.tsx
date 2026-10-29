import { memo, useId, useMemo } from 'react';
import { Checkbox } from '../../components/ui/Checkbox';
import { DropMenu } from '../../components/ui/DropMenu';
import type { RunId } from '../../model/types';
import { displayName } from '../../util/displayName';
import { DisplayName } from '../../util/DisplayName';
import type { WritebackEntry, WritebackSkip, WritebackTablePlan } from '../../writeback/plan';
import { keptKey, skipCounts } from '../../writeback/plan';
import { changeCount, zippable } from './model';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Header strings are shown without their Markdown hint suffix (`|align right`, `|hidden`). */
const columnLabel = (column: string): string => column.split('|')[0];

const SKIP_TAG: Partial<Record<WritebackSkip, string>> = {
  tolerance: 'within tolerance',
  episodes: 'episodes differ',
  'non-numeric': 'no numeric value',
};

function SkipSummary({ entries }: { entries: WritebackEntry[] }) {
  const id = useId();
  const counts = skipCounts(entries);
  const total = counts.reduce((n, [, c]) => n + c, 0);
  if (total === 0) return null;
  const detail = counts.map(([r, n]) => `${n} ${r}`).join(' · ');
  return (
    <span
      tabIndex={0}
      aria-describedby={id}
      className="group relative rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
    >
      {total} skipped
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute top-full left-0 z-20 mt-1 hidden rounded-md border border-border bg-panel px-2 py-1 text-[11px] whitespace-nowrap text-text shadow-lg group-hover:block group-focus:block"
      >
        {detail}
      </span>
    </span>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <span aria-hidden="true" className="inline-block w-3 text-[10px] text-faint">
      {open ? '▾' : '▸'}
    </span>
  );
}

interface CardProps {
  tp: WritebackTablePlan;
  runId: RunId;
  runLabel: string;
  open: boolean;
  enabled: boolean;
  onToggleOpen(path: string): void;
  onToggleEnabled(path: string, on: boolean): void;
  onToggleKept(key: string): void;
  onDownload(tp: WritebackTablePlan): void;
  onCopyLog(tp: WritebackTablePlan): void;
}

/** One baseline table: include checkbox, summary, single-file download and the cell diff. */
export const TableCard = memo(function TableCard({
  tp,
  runId,
  runLabel,
  open,
  enabled,
  onToggleOpen,
  onToggleEnabled,
  onToggleKept,
  onDownload,
  onCopyLog,
}: CardProps) {
  const changed = changeCount(tp);
  const skipped = tp.entries.length - changed;
  const absent = tp.experiments > 0 && tp.notInRun.length === tp.experiments;
  const empty = tp.entries.length === 0;
  const canZip = zippable(tp);
  const rows = new Set(tp.entries.map((e) => e.rowIndex)).size;
  const runName = displayName(runLabel).text;

  let summary;
  if (absent) {
    summary = (
      <span className="text-warn">
        skipped · {plural(tp.notInRun.length, 'experiment', 'experiments')} not in {runName}
      </span>
    );
  } else if (empty) {
    summary = <span className="text-muted">no changes</span>;
  } else {
    summary = (
      <span className={skipped > 0 ? 'text-warn' : 'text-muted'}>
        {plural(rows, 'row', 'rows')} · {plural(changed, 'cell', 'cells')} changed
        {skipped > 0 && (
          <>
            {' · '}
            <SkipSummary entries={tp.entries} />
          </>
        )}
        {tp.notInRun.length > 0 && ` · ${tp.notInRun.length} not in ${runName}`}
      </span>
    );
  }

  const muted = empty || absent;
  return (
    <section
      className={`rounded-lg border border-border bg-panel ${muted ? 'opacity-90' : ''}`}
      aria-label={displayName(tp.path).full}
    >
      <div className="flex min-w-0 items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => onToggleOpen(tp.path)}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${displayName(tp.path).full}`}
          className="mt-0.5 rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Caret open={open} />
        </button>
        <Checkbox
          checked={enabled && canZip && changed > 0}
          disabled={!canZip || changed === 0}
          onChange={(on) => onToggleEnabled(tp.path, on)}
          className="mt-0.5 shrink-0"
          label={<span className="sr-only">Include {displayName(tp.path).full} in the zip</span>}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <DisplayName
            value={tp.path}
            className={`font-mono text-[13px] ${muted ? 'text-muted' : 'text-text'}`}
          />
          <span className="text-[11px]">{summary}</span>
          {!canZip && changed > 0 && (
            <span className="text-[11px] text-muted">
              file name cannot be zipped safely — use Download this file
            </span>
          )}
        </div>
        {changed > 0 && (
          <DropMenu
            align="right"
            variant="ghost"
            size="sm"
            ariaLabel={`Download ${displayName(tp.path).full}`}
            label={
              <>
                Download this file
                <span aria-hidden="true" className="text-[10px]">
                  ▾
                </span>
              </>
            }
            items={[
              {
                key: 'csv',
                label: 'Download the updated CSV',
                description: 'Same rows, columns and quoting; only changed cells differ',
                onSelect: () => onDownload(tp),
              },
              {
                key: 'log',
                label: 'Copy this file’s change log',
                onSelect: () => onCopyLog(tp),
              },
            ]}
          />
        )}
      </div>
      {open && !empty && <DiffTable tp={tp} runId={runId} onToggleKept={onToggleKept} />}
      {open && empty && (
        <p className="border-t border-border px-4 py-3 text-[12px] text-muted">
          {absent
            ? 'None of this table’s experiments has a row in the run.'
            : 'Every value already matches the run.'}
        </p>
      )}
    </section>
  );
});

function DiffTable({
  tp,
  runId,
  onToggleKept,
}: {
  tp: WritebackTablePlan;
  runId: RunId;
  onToggleKept(key: string): void;
}) {
  const { header, rows } = tp.table.csv;
  const unwritable = useMemo(() => new Set(tp.unwritable), [tp.unwritable]);
  // Rows in plan order (experiment order); each cell's entry by column index.
  const byRow = useMemo(() => {
    const m = new Map<number, Map<number, WritebackEntry>>();
    for (const e of tp.entries) {
      if (!m.has(e.rowIndex)) m.set(e.rowIndex, new Map());
      m.get(e.rowIndex)!.set(e.columnIndex, e);
    }
    return m;
  }, [tp.entries]);

  return (
    <div className="border-t border-border px-4 pt-2 pb-3">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-row-alt">
              {header.map((h, c) => (
                <th
                  key={c}
                  scope="col"
                  className="max-w-[180px] px-2 py-1.5 align-top font-mono text-[11px] font-normal text-muted"
                >
                  <DisplayName value={columnLabel(h)} className="block" />
                  {unwritable.has(h) && (
                    <span className="block font-sans text-[10px] text-faint">
                      not writable: baseline column is transformed
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...byRow.entries()].map(([r, cells]) => (
              <tr key={r} className="border-b border-border last:border-b-0">
                {header.map((h, c) => {
                  const e = cells.get(c);
                  const text = rows[r][c] ?? '';
                  return (
                    <td key={c} className="px-1 py-1 align-middle">
                      {e === undefined || e.skipped === 'transform' || unwritable.has(h) ? (
                        <PlainCell text={text} first={c === 0} />
                      ) : (
                        <EntryCell
                          entry={e}
                          onToggle={() =>
                            onToggleKept(keptKey(runId, tp.path, e.experiment, e.column))
                          }
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-faint">
        Click a changed cell to keep the old value. Other columns and row order stay exactly as in
        the file.
      </p>
    </div>
  );
}

function PlainCell({ text, first }: { text: string; first: boolean }) {
  return (
    <DisplayName
      value={text}
      className={`block px-1 font-mono text-[12px] ${first ? 'text-text' : 'text-muted'}`}
    />
  );
}

function EntryCell({ entry, onToggle }: { entry: WritebackEntry; onToggle(): void }) {
  const old = displayName(entry.old).text;
  const next = displayName(entry.new).text;
  if (entry.skipped === undefined || entry.skipped === 'kept') {
    const kept = entry.skipped === 'kept';
    return (
      <button
        type="button"
        aria-pressed={kept}
        onClick={onToggle}
        title={kept ? 'Kept: click to write the new value' : 'Click to keep the old value'}
        aria-label={kept ? `${old} kept (new value ${next})` : `${old} changes to ${next}`}
        className={`flex w-full min-w-[72px] flex-col items-start rounded-md px-2 py-1 font-mono text-[12px] focus-visible:outline-2 focus-visible:outline-accent ${
          kept ? 'border border-border bg-row-alt' : 'bg-accent-bg hover:opacity-90'
        }`}
      >
        {kept ? (
          <>
            <span className="text-[10px] text-faint line-through">→ {next}</span>
            <span className="flex items-center gap-1.5 text-text">
              {old}
              <span className="font-sans text-[10px] text-muted">kept</span>
            </span>
          </>
        ) : (
          <>
            <span className="text-[10px] text-muted line-through">{old}</span>
            <span className="text-accent">→ {next}</span>
          </>
        )}
      </button>
    );
  }
  const tag = SKIP_TAG[entry.skipped];
  return (
    <span
      className="flex flex-col px-1 font-mono text-[12px] text-muted"
      title={entry.skipped === 'non-numeric' ? undefined : `Would be ${next}`}
    >
      {old}
      {tag !== undefined && <span className="font-sans text-[10px] text-faint">{tag}</span>}
    </span>
  );
}
