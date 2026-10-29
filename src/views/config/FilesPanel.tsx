import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { runBg } from '../../components/runColor';
import { PanelTabs, TabPanel } from '../../components/ui/PanelTabs';
import { SearchInput } from '../../components/ui/SearchInput';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import type { Source, SourceKind } from '../../model/types';
import { useFilesModel, useLoadedSources } from '../../state/selectors';
import { useAppStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { displayName } from '../../util/displayName';
import { COLUMN_MIME, EXPERIMENTS_MIME, setCountDragImage } from './dnd';
import { FOCUS_RING } from './fields';
import {
  WANDB_ONLY,
  addExperiments,
  assignColumn,
  clickSelection,
  columnUsers,
  columnsByKind,
  filterFiles,
  type FilesFilter,
  type FilesRow,
} from './model';
import { commitEdit, useSelectedGroup, useSelectedMetricKey } from './selection';

/** Rows rendered at most (a huge wandb export stays responsive; the filter narrows the list). */
const ROW_CAP = 1000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function sourceName(i: number): string {
  return i === 0 ? 'base' : `run ${i}`;
}

/** Colour of the presence dot of source `i` of `[baseline, ...runs]` (or of runs only). */
function dotClass(i: number, hasBaseline: boolean): string {
  if (hasBaseline && i === 0) return 'bg-baseline';
  return runBg(hasBaseline ? i - 1 : i);
}

function Legend({ sources, hasBaseline }: { sources: Source[]; hasBaseline: boolean }) {
  if (sources.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
      <span>in:</span>
      {sources.map((s, i) => (
        <span key={s.id} className="flex items-center gap-1" title={displayName(s.label).full}>
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotClass(i, hasBaseline)}`} />
          {hasBaseline ? sourceName(i) : `run ${i + 1}`}
        </span>
      ))}
    </p>
  );
}

function Dots({ row, hasBaseline }: { row: FilesRow; hasBaseline: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
      {row.presence.map((p, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${p ? dotClass(i, hasBaseline) : 'border border-border'}`}
        />
      ))}
    </span>
  );
}

/** The EXPERIMENTS tab: filter, Unassigned / Assigned / All, sections by table, multi-select. */
function ExperimentsTab({ filter }: { filter: string }) {
  const model = useFilesModel();
  const sources = useLoadedSources();
  const hasBaseline = useAppStore((s) => s.sources.baseline !== null);
  const filesFilter = useAppStore((s) => s.session.config.filesFilter);
  const selection = useAppStore((s) => s.session.config.selectedExperiments);
  const setSession = useAppStore((s) => s.setSession);
  const group = useSelectedGroup();
  const [message, setMessage] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const sections = useMemo(
    () => filterFiles(model.sections, filesFilter, filter),
    [model.sections, filesFilter, filter],
  );
  // Rendered order (for shift-click ranges), capped like the rendering.
  const visible = useMemo(() => {
    const out: string[] = [];
    for (const s of sections) for (const r of s.rows) if (out.length < ROW_CAP) out.push(r.name);
    return out;
  }, [sections]);
  const shownTotal = sections.reduce((n, s) => n + s.rows.length, 0);

  const select = (next: string[]) => setSession({ config: { selectedExperiments: next } });

  const addToGroup = (names: string[]) => {
    if (group === null) {
      setMessage('Create a group first');
      return;
    }
    setMessage(commitEdit((c) => addExperiments(c, group.name, names)));
    select([]);
  };

  const onClick = (e: MouseEvent, name: string) =>
    select(
      clickSelection(
        selection,
        name,
        { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey },
        visible,
      ),
    );

  const focusRow = (from: HTMLElement, step: number) => {
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-exp-row]') ?? []);
    rows[rows.indexOf(from) + step]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, name: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addToGroup(selection.length > 0 ? selection : [name]);
    } else if (e.key === ' ') {
      e.preventDefault();
      // Space builds a selection from the keyboard (toggle; with Shift, the range).
      select(clickSelection(selection, name, { shift: e.shiftKey, toggle: !e.shiftKey }, visible));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusRow(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
    }
  };

  const onDragStart = (e: DragEvent, name: string) => {
    const names = selection.includes(name) ? selection : [name];
    e.dataTransfer.setData(EXPERIMENTS_MIME, JSON.stringify(names));
    e.dataTransfer.setData('text/plain', names.join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
    setCountDragImage(e.dataTransfer, names.length);
  };

  let budget = ROW_CAP;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SegmentedControl<FilesFilter>
        dense
        ariaLabel="Show experiments"
        value={filesFilter}
        onChange={(v) => setSession({ config: { filesFilter: v } })}
        options={[
          { value: 'unassigned', label: `Unassigned ${model.unassigned}` },
          { value: 'assigned', label: `Assigned ${model.assigned}` },
          { value: 'all', label: `All ${model.total}` },
        ]}
      />
      <Legend sources={sources} hasBaseline={hasBaseline} />
      <div ref={list} className="-mx-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1">
        {sources.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-muted">
            Load a baseline or runs to list their experiments here.
          </p>
        ) : sections.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-muted">No experiments match.</p>
        ) : (
          sections.map((s) => {
            if (budget <= 0) return null;
            const rows = s.rows.slice(0, budget);
            budget -= rows.length;
            return (
              <section key={s.id} aria-label={s.id === WANDB_ONLY ? 'wandb only' : s.id}>
                <h3 className="mt-2 mb-1 font-mono text-[11px] text-faint">
                  {s.id === WANDB_ONLY ? 'wandb only' : <DisplayName value={s.id} />}
                </h3>
                <ul className="flex flex-col">
                  {rows.map((r) => {
                    const sel = selection.includes(r.name);
                    const where = r.presence
                      .map((p, i) => (p ? (hasBaseline ? sourceName(i) : `run ${i + 1}`) : null))
                      .filter((x) => x !== null)
                      .join(', ');
                    return (
                      <li key={r.name}>
                        <button
                          type="button"
                          data-exp-row=""
                          draggable
                          aria-pressed={sel}
                          aria-label={`${displayName(r.name).full}${where ? `, in ${where}` : ''}${r.assigned ? ', assigned' : ''}`}
                          onClick={(e) => onClick(e, r.name)}
                          onKeyDown={(e) => onKeyDown(e, r.name)}
                          onDragStart={(e) => onDragStart(e, r.name)}
                          className={`flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left ${
                            sel ? 'bg-accent-bg' : 'hover:bg-row-alt'
                          } ${FOCUS_RING}`}
                        >
                          <span aria-hidden="true" className="shrink-0 text-[12px] text-faint">
                            ⠿
                          </span>
                          <DisplayName
                            value={r.name}
                            className={`flex-1 font-mono text-[12px] ${sel ? 'text-accent' : 'text-text'}`}
                          />
                          <Dots row={r} hasBaseline={hasBaseline} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
        {shownTotal > ROW_CAP && (
          <p className="py-2 text-[11px] text-muted">
            Showing {ROW_CAP} of {shownTotal}; type in the filter to narrow the list.
          </p>
        )}
      </div>
      {message !== null && (
        <p role="alert" className="text-[11px] text-danger">
          {message}
        </p>
      )}
      <p className="text-[11px] text-faint">
        {selection.length > 0
          ? `${plural(selection.length, 'experiment', 'experiments')} selected · ⏎ adds to `
          : 'Shift-click to select several · ⏎ adds to '}
        {group ? <DisplayName value={group.name} className="font-mono" /> : 'the selected group'}
        {selection.length > 0 && ' · Esc clears'}
      </p>
    </div>
  );
}

const KIND_LABEL: Record<SourceKind, string> = {
  repo: 'Repo table columns',
  wandb: 'Wandb columns',
};

/** The COLUMNS tab: every distinct column per kind with its users; drag onto a metric column box. */
function ColumnsTab({ filter }: { filter: string }) {
  const sources = useLoadedSources();
  const config = useAppStore((s) => s.config.active.config);
  const metricKey = useSelectedMetricKey();
  const [message, setMessage] = useState<string | null>(null);
  const columns = useMemo(() => columnsByKind(sources), [sources]);
  const q = filter.trim().toLowerCase();
  const kinds: SourceKind[] = ['repo', 'wandb'];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="-mx-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1">
        {sources.length === 0 && (
          <p className="py-6 text-center text-[12px] text-muted">
            Load a baseline or runs to list their columns here.
          </p>
        )}
        {kinds.map((kind) => {
          const cols = columns[kind].filter((c) => q === '' || c.toLowerCase().includes(q));
          if (cols.length === 0) return null;
          return (
            <section key={kind} aria-label={KIND_LABEL[kind]}>
              <h3 className="mt-2 mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                {KIND_LABEL[kind]}
              </h3>
              <ul className="flex flex-col">
                {cols.map((col) => {
                  const users = columnUsers(config, kind, col);
                  return (
                    <li key={col}>
                      <button
                        type="button"
                        draggable
                        title={
                          metricKey
                            ? `Drag onto a metric column box, or press Enter to use it for ${metricKey}`
                            : 'Drag onto a metric column box'
                        }
                        aria-label={`${displayName(col).full}, ${users.length > 0 ? `used by ${users.join(', ')}` : 'unused'}`}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            COLUMN_MIME,
                            JSON.stringify({ kind, column: col }),
                          );
                          e.dataTransfer.setData('text/plain', col);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          if (metricKey === null) {
                            setMessage('Select a metric first');
                            return;
                          }
                          const err = commitEdit((c) => assignColumn(c, metricKey, kind, col));
                          setMessage(err);
                        }}
                        className={`flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-row-alt ${FOCUS_RING}`}
                      >
                        <span aria-hidden="true" className="shrink-0 text-[12px] text-faint">
                          ⠿
                        </span>
                        <DisplayName
                          value={col}
                          className="flex-1 font-mono text-[12px] text-text"
                        />
                        <span
                          className={`max-w-[45%] shrink-0 truncate text-[11px] ${users.length > 0 ? 'text-muted' : 'text-faint'}`}
                        >
                          {users.length > 0 ? `used by ${users.join(', ')}` : 'unused'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {message !== null && (
        <p role="alert" className="text-[11px] text-danger">
          {message}
        </p>
      )}
      <p className="text-[11px] text-faint">
        Drag a column onto a metric column box · ⏎ uses it for{' '}
        {metricKey ? <span className="font-mono">{metricKey}</span> : 'the selected metric'}
      </p>
    </div>
  );
}

/** Left panel of the Config view: "From your files" (spec Phase 4a). Self-contained. */
export function FilesPanel() {
  const model = useFilesModel();
  const sources = useLoadedSources();
  const tab = useAppStore((s) => s.session.config.filesTab);
  const setSession = useAppStore((s) => s.setSession);
  const hasSelection = useAppStore((s) => s.session.config.selectedExperiments.length > 0);
  const [filter, setFilter] = useState('');
  const columns = useMemo(() => columnsByKind(sources), [sources]);
  return (
    <section
      id="config-files-panel"
      tabIndex={-1}
      aria-label="From your files"
      className="flex min-h-0 min-w-0 flex-col gap-3 rounded-xl border border-border bg-panel p-4 outline-none"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && hasSelection) {
          e.stopPropagation();
          setSession({ config: { selectedExperiments: [] } });
        }
      }}
    >
      <header>
        <h2 className="text-[14px] font-semibold text-text">From your files</h2>
        <p className="text-[12px] text-muted">
          {plural(sources.length, 'source', 'sources')} · drag into a group
        </p>
      </header>
      <PanelTabs
        tabs={[
          { id: 'experiments' as const, label: `Experiments ${model.total}` },
          {
            id: 'columns' as const,
            label: `Columns ${columns.repo.length + columns.wandb.length}`,
          },
        ]}
        value={tab}
        onChange={(t) => setSession({ config: { filesTab: t } })}
        ariaLabel="From your files"
        idPrefix="config-files"
      />
      <SearchInput value={filter} onChange={setFilter} placeholder="Filter…" shortcut />
      <TabPanel idPrefix="config-files" id={tab} className="flex min-h-0 flex-1 flex-col">
        {tab === 'experiments' ? (
          <ExperimentsTab filter={filter} />
        ) : (
          <ColumnsTab filter={filter} />
        )}
      </TabPanel>
    </section>
  );
}
