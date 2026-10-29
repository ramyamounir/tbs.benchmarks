import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { rowChoiceKey } from '../../compare/compare';
import { Button } from '../../components/ui/Button';
import { DropMenu } from '../../components/ui/DropMenu';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { LIMITS } from '../../config/schema';
import type { Config, Group, Source } from '../../model/types';
import { useLoadedSources } from '../../state/selectors';
import { useAppStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { displayName } from '../../util/displayName';
import {
  EXPERIMENTS_MIME,
  GROUP_EXPERIMENT_MIME,
  METRIC_CHIP_MIME,
  hasType,
  readExperiments,
} from './dnd';
import { FOCUS_RING, MatchModeEditor } from './fields';
import {
  addExperiments,
  duplicateGroup,
  groupNameError,
  metricMissingInBaseline,
  moveItem,
  parseNames,
  presenceIn,
  regexMatchCount,
  tableOptions,
  updateGroup,
  type Presence,
} from './model';
import {
  commitEdit,
  selectGroup,
  selectMetric,
  useSelectedGroup,
  useSelectedMetricKey,
} from './selection';

const NONE = '\u0000none';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fileOf = (path: string) => path.split('/').at(-1) ?? path;

function sourceName(i: number): string {
  return i === 0 ? 'base' : `run ${i}`;
}

function SectionTitle({ children, aside }: { children: string; aside?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">{children}</h3>
      {aside !== undefined && <span className="text-[11px] text-faint">{aside}</span>}
    </div>
  );
}

/** Title (editable), Rename, and the `…` menu (duplicate, move up/down, delete with confirmation). */
function GroupHeader({ group, index, count }: { group: Group; index: number; count: number }) {
  const config = useAppStore((s) => s.config.active.config);
  const renameGroup = useAppStore((s) => s.renameGroup);
  const deleteGroup = useAppStore((s) => s.deleteGroup);
  const [draft, setDraft] = useState(group.name);
  const [prev, setPrev] = useState(group.name);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (prev !== group.name) {
    setPrev(group.name);
    setDraft(group.name);
    setConfirm(false);
  }
  const error = draft === group.name ? null : groupNameError(config, group.name, draft);
  const rename = () => {
    if (draft === group.name || error !== null) return;
    renameGroup(group.name, draft);
  };
  const charts = config.charts.filter((c) => c.group === group.name).length;
  const move = (to: number) => {
    useAppStore.getState().updateConfig((c) => ({ ...c, groups: moveItem(c.groups, index, to) }));
  };

  return (
    <header className="flex flex-col gap-1">
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <TextInput
            value={draft}
            onChange={setDraft}
            mono
            aria-label="Group name"
            invalid={error !== null}
            aria-describedby={error !== null ? 'group-name-error' : undefined}
            className="h-8 w-full border-transparent text-[16px] font-semibold hover:border-border"
            onKeyDown={(e) => {
              if (e.key === 'Enter') rename();
              if (e.key === 'Escape' && draft !== group.name) {
                e.stopPropagation();
                setDraft(group.name);
              }
            }}
          />
          {error !== null && (
            <p id="group-name-error" className="text-[11px] text-danger">
              {error}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={rename}
          disabled={draft === group.name || error !== null}
        >
          Rename
        </Button>
        <DropMenu
          size="sm"
          variant="ghost"
          align="right"
          ariaLabel="Group actions"
          label={<span aria-hidden="true">⋯</span>}
          items={[
            {
              key: 'dup',
              label: 'Duplicate',
              description: 'Same table, matching and metrics; no experiments',
              onSelect: () => {
                let name: string | null = null;
                setMessage(
                  commitEdit((c) => {
                    const r = duplicateGroup(c, group.name);
                    if ('config' in r) name = r.config.groups[index + 1]?.name ?? null;
                    return r;
                  }),
                );
                if (name !== null) selectGroup(name);
              },
            },
            {
              key: 'up',
              label: 'Move up',
              disabled: index === 0,
              onSelect: () => move(index - 1),
            },
            {
              key: 'down',
              label: 'Move down',
              disabled: index >= count - 1,
              onSelect: () => move(index + 1),
            },
            { key: 'delete', label: 'Delete group…', onSelect: () => setConfirm(true) },
          ]}
        />
      </div>
      <p className="px-2.5 text-[12px] text-muted">
        Group · {plural(group.experiments.length, 'experiment', 'experiments')} ·{' '}
        {plural(group.metrics.length, 'metric', 'metrics')}
      </p>
      {message !== null && (
        <p role="alert" className="px-2.5 text-[11px] text-danger">
          {message}
        </p>
      )}
      {confirm && (
        <div
          role="group"
          aria-label="Confirm delete"
          className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-warn bg-warn-bg px-3 py-2 text-[12px] text-text"
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            Delete <DisplayName value={group.name} className="font-mono" />?
            {charts > 0 && ` Its ${plural(charts, 'chart is', 'charts are')} removed too.`}
          </span>
          <Button size="sm" variant="primary" autoFocus onClick={() => deleteGroup(group.name)}>
            Delete
          </Button>
          <Button size="sm" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </div>
      )}
    </header>
  );
}

function BaselineTable({ group, sources }: { group: Group; sources: Source[] }) {
  const config = useAppStore((s) => s.config.active.config);
  const baseline = useAppStore((s) => s.sources.baseline);
  const options = useMemo(() => tableOptions(config, sources), [config, sources]);
  const loadedInBaseline =
    group.table === null ||
    baseline === null ||
    baseline.kind !== 'repo' ||
    baseline.tables.some((t) => t.path === group.table);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Select
        mono
        aria-label="Baseline table"
        className="w-full"
        value={group.table ?? NONE}
        onChange={(v) => {
          const table = v === NONE ? null : v;
          if (table !== null && table.length > LIMITS.stringLength) return;
          useAppStore
            .getState()
            .updateConfig((c) => updateGroup(c, group.name, (g) => ({ ...g, table })));
        }}
        options={[
          ...options.map((o) => ({
            value: o.path,
            label: `${displayName(o.path).text}${o.loaded ? '' : '  (not loaded)'}`,
          })),
          { value: NONE, label: 'none (wandb only)' },
        ]}
      />
      {!loadedInBaseline && (
        <p className="text-[11px] text-warn">
          <span aria-hidden="true">! </span>This table is not in the loaded baseline
        </p>
      )}
    </div>
  );
}

function MetricChips({ group }: { group: Group }) {
  const config = useAppStore((s) => s.config.active.config);
  const baseline = useAppStore((s) => s.sources.baseline);
  const selected = useSelectedMetricKey();
  const [over, setOver] = useState<number | null>(null);
  const chips = useRef(new Map<string, HTMLButtonElement>());
  const unused = Object.keys(config.metrics).filter((k) => !group.metrics.includes(k));

  const setMetrics = (metrics: string[]) =>
    useAppStore
      .getState()
      .updateConfig((c) => updateGroup(c, group.name, (g) => ({ ...g, metrics })));
  const move = (key: string, to: number) => {
    const from = group.metrics.indexOf(key);
    if (from < 0 || to < 0 || to >= group.metrics.length || from === to) return;
    setMetrics(moveItem(group.metrics, from, to));
    requestAnimationFrame(() => chips.current.get(key)?.focus());
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {group.metrics.map((key, i) => {
        const known = Object.hasOwn(config.metrics, key);
        const ghost = known && metricMissingInBaseline(config, group, key, baseline);
        const isSel = key === selected;
        const label = known ? config.metrics[key].label : key;
        const tone = !known
          ? 'border-danger text-danger'
          : isSel
            ? 'border-accent bg-accent-bg text-accent'
            : ghost
              ? 'border-dashed border-border text-faint'
              : 'border-border text-text';
        return (
          <span
            key={key}
            className={`inline-flex min-w-0 items-center rounded-full border ${tone} ${
              over === i ? 'ring-2 ring-accent' : ''
            }`}
            onDragOver={(e) => {
              if (!hasType(e.dataTransfer, METRIC_CHIP_MIME)) return;
              e.preventDefault();
              setOver(i);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              setOver(null);
              if (!hasType(e.dataTransfer, METRIC_CHIP_MIME)) return;
              e.preventDefault();
              move(e.dataTransfer.getData(METRIC_CHIP_MIME), i);
            }}
          >
            <button
              ref={(el) => {
                if (el) chips.current.set(key, el);
                else chips.current.delete(key);
              }}
              type="button"
              draggable
              aria-pressed={isSel}
              title={
                !known
                  ? `Unknown metric "${key}"`
                  : ghost
                    ? 'The baseline table has no column for this metric · drag or ←/→ to reorder'
                    : 'Select · drag or ←/→ to reorder'
              }
              onDragStart={(e) => {
                e.dataTransfer.setData(METRIC_CHIP_MIME, key);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => known && selectMetric(key)}
              onKeyDown={(e: KeyboardEvent) => {
                const step =
                  e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                    ? -1
                    : e.key === 'ArrowRight' || e.key === 'ArrowDown'
                      ? 1
                      : 0;
                if (step === 0) return;
                e.preventDefault();
                move(key, i + step);
              }}
              className={`min-w-0 truncate rounded-full py-0.5 pr-1 pl-3 text-[13px] ${FOCUS_RING}`}
            >
              <DisplayName value={label} />
              {!known && ' ?'}
            </button>
            <button
              type="button"
              aria-label={`Remove ${displayName(label).full} from this group`}
              title="Remove from this group"
              onClick={() => setMetrics(group.metrics.filter((k) => k !== key))}
              className={`mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] text-muted hover:bg-row-alt hover:text-text ${FOCUS_RING}`}
            >
              ×
            </button>
          </span>
        );
      })}
      <DropMenu
        size="sm"
        variant="ghost"
        label="+ metric"
        ariaLabel="Add a metric to this group"
        items={
          unused.length === 0
            ? [
                {
                  key: 'none',
                  label: 'Every metric is in this group',
                  disabled: true,
                  onSelect: () => {},
                },
              ]
            : unused.map((k) => ({
                key: k,
                label: <span className="font-mono text-[12px]">{k}</span>,
                description: <DisplayName value={config.metrics[k].label} />,
                onSelect: () => setMetrics([...group.metrics, k]),
              }))
        }
      />
    </div>
  );
}

/** ✓ / — / "n rows" for one experiment in one source. */
function PresenceCell({ p, label }: { p: Presence; label: string }) {
  if (p.table === null) {
    return (
      <span className="text-center text-faint" title={`${label}: no table for this group`}>
        ·
      </span>
    );
  }
  if (p.candidates.length === 0) {
    return (
      <span className="text-center text-faint" title={`${label}: not found`}>
        —
      </span>
    );
  }
  if (p.candidates.length > 1) {
    return (
      <span className="flex justify-center" title={`${label}: ${p.candidates.length} rows`}>
        <span className="rounded bg-warn-bg px-1 text-[10px] whitespace-nowrap text-warn">
          {p.candidates.length} rows
        </span>
      </span>
    );
  }
  return (
    <span className="text-center text-accent" title={`${label}: found`}>
      ✓
    </span>
  );
}

interface DupNotice {
  source: Source;
  experiment: string;
  p: Presence;
}

function DuplicateNotice({ notice, config }: { notice: DupNotice; config: Config }) {
  const chooseRow = useAppStore((s) => s.chooseRow);
  const { source, experiment, p } = notice;
  if (p.table === null || p.chosen === null) return null;
  const table = p.table;
  const n = p.candidates.length;
  const k = p.candidates.indexOf(p.chosen) + 1;
  const idc = table.csv.header.indexOf(config.sources[source.kind].id_column);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 rounded-lg border border-border bg-row-alt px-3 py-2 text-[12px] text-text">
      <span className="flex min-w-0 flex-wrap gap-x-1">
        <DisplayName value={fileOf(table.path)} className="font-mono" /> has {n} rows for{' '}
        <DisplayName value={experiment} className="font-mono" />
      </span>
      <span className="text-muted">
        · Using row {k} of {n} ({p.override ? 'chosen' : 'first in file, as v1'}) ·
      </span>
      <DropMenu
        size="sm"
        variant="ghost"
        label="Choose row ▾"
        ariaLabel={`Choose the row of ${displayName(experiment).full} in ${displayName(source.label).full}`}
        items={p.candidates.map((row, i) => ({
          key: String(row),
          label: (
            <span className="flex min-w-0 items-center gap-1.5">
              {row === p.chosen && <span aria-hidden="true">✓</span>}
              <DisplayName
                value={idc >= 0 ? (table.csv.rows[row][idc] ?? '') : `row ${row + 1}`}
                className="font-mono text-[12px]"
              />
            </span>
          ),
          description: `match ${i + 1} of ${n} · file row ${row + 1}`,
          onSelect: () => chooseRow(rowChoiceKey(source.id, table.path, experiment), row),
        }))}
      />
    </div>
  );
}

/** Drop zone + paste area: names are split by newlines/commas, trimmed and deduplicated. */
function ExperimentDrop({ group, onMessage }: { group: Group; onMessage(m: string | null): void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const add = (names: string[]) => {
    if (names.length === 0) return;
    onMessage(commitEdit((c) => addExperiments(c, group.name, names)));
  };
  const accepts = (e: DragEvent) =>
    hasType(e.dataTransfer, EXPERIMENTS_MIME) || hasType(e.dataTransfer, 'text/plain');
  return (
    <div
      className={`rounded-lg border border-dashed px-3 py-3 ${over ? 'border-accent bg-accent-bg' : 'border-border'}`}
      onDragOver={(e) => {
        if (!accepts(e) || hasType(e.dataTransfer, 'Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (hasType(e.dataTransfer, 'Files')) return; // page-level file drop handles it
        if (hasType(e.dataTransfer, EXPERIMENTS_MIME)) {
          e.preventDefault();
          add(readExperiments(e.dataTransfer));
          useAppStore.getState().setSession({ config: { selectedExperiments: [] } });
        } else if (hasType(e.dataTransfer, 'text/plain')) {
          e.preventDefault();
          add(parseNames(e.dataTransfer.getData('text/plain')));
        }
      }}
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={text}
            aria-label="Experiment names, one per line"
            placeholder="Paste names (one per line)"
            spellCheck={false}
            rows={4}
            onChange={(e) => setText(e.currentTarget.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text/plain');
              if (pasted === '' || text.trim() !== '') return;
              e.preventDefault();
              add(parseNames(pasted));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setText('');
                setEditing(false);
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                add(parseNames(text));
                setText('');
              }
            }}
            className={`w-full rounded-md border border-border bg-panel px-2.5 py-1.5 font-mono text-[12px] text-text placeholder:text-faint ${FOCUS_RING}`}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={text.trim() === ''}
              onClick={() => {
                add(parseNames(text));
                setText('');
              }}
            >
              Add names
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setText('');
                setEditing(false);
              }}
            >
              Done
            </Button>
            <span className="text-[11px] text-faint">Ctrl+Enter adds · Esc closes</span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          onFocus={() => setEditing(true)}
          className={`w-full rounded text-center text-[13px] text-muted ${FOCUS_RING}`}
        >
          Drop experiments here, or paste names (one per line)
        </button>
      )}
    </div>
  );
}

function ExperimentsTable({ group, sources }: { group: Group; sources: Source[] }) {
  const config = useAppStore((s) => s.config.active.config);
  const rowChoices = useAppStore((s) => s.session.rowChoices);
  const hasBaseline = useAppStore((s) => s.sources.baseline !== null);
  const [message, setMessage] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const handles = useRef(new Map<string, HTMLButtonElement>());

  const rows = useMemo(
    () =>
      [...new Set(group.experiments)].map((name) => ({
        name,
        cells: sources.map((s) => presenceIn(config, group, s, name, rowChoices)),
      })),
    [config, group, sources, rowChoices],
  );
  const notices: DupNotice[] = [];
  for (const r of rows)
    r.cells.forEach((p, i) => {
      if (p.candidates.length > 1) notices.push({ source: sources[i], experiment: r.name, p });
    });

  const labels = sources.map((_, i) => (hasBaseline ? sourceName(i) : `run ${i + 1}`));
  const setExperiments = (experiments: string[]) =>
    useAppStore
      .getState()
      .updateConfig((c) => updateGroup(c, group.name, (g) => ({ ...g, experiments })));
  const move = (name: string, to: number) => {
    const from = group.experiments.indexOf(name);
    if (from < 0 || to < 0 || to >= group.experiments.length || from === to) return;
    setExperiments(moveItem(group.experiments, from, to));
    requestAnimationFrame(() => handles.current.get(name)?.focus());
  };
  const grid = {
    // The name column keeps 80 px; narrower panels scroll the table sideways (Phase 7).
    gridTemplateColumns: `16px minmax(80px,1fr) ${sources.map(() => '48px').join(' ')} 24px`,
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`flex flex-col rounded-lg ${over ? 'ring-2 ring-accent' : ''}`}
        onDragOver={(e) => {
          if (!hasType(e.dataTransfer, EXPERIMENTS_MIME)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          if (!hasType(e.dataTransfer, EXPERIMENTS_MIME)) return;
          e.preventDefault();
          const names = readExperiments(e.dataTransfer);
          setMessage(commitEdit((c) => addExperiments(c, group.name, names)));
          useAppStore.getState().setSession({ config: { selectedExperiments: [] } });
        }}
      >
        <div className="min-w-0 overflow-x-auto">
          <div
            className="grid items-center gap-x-2 px-1 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase"
            style={grid}
          >
            <span />
            <h3>Experiments</h3>
            {labels.map((l, i) => (
              <span
                key={sources[i].id}
                className="truncate text-center font-normal normal-case"
                title={displayName(sources[i].label).full}
              >
                {l}
              </span>
            ))}
            <span />
          </div>
          {rows.length === 0 && (
            <p className="px-1 py-3 text-[12px] text-muted">No experiments in this group yet.</p>
          )}
          <ol aria-label="Experiments of this group" className="flex flex-col">
            {rows.map((r, i) => {
              const unknown = sources.length > 0 && r.cells.every((p) => p.candidates.length === 0);
              return (
                <li
                  key={r.name}
                  className={`grid items-center gap-x-2 rounded-md px-1 py-1 text-[12px] ${i % 2 === 0 ? 'bg-row-alt' : ''}`}
                  style={grid}
                  onDragOver={(e) => {
                    if (!hasType(e.dataTransfer, GROUP_EXPERIMENT_MIME)) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (!hasType(e.dataTransfer, GROUP_EXPERIMENT_MIME)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    move(e.dataTransfer.getData(GROUP_EXPERIMENT_MIME), i);
                  }}
                >
                  <button
                    ref={(el) => {
                      if (el) handles.current.set(r.name, el);
                      else handles.current.delete(r.name);
                    }}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(GROUP_EXPERIMENT_MIME, r.name);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                      e.preventDefault();
                      move(r.name, i + (e.key === 'ArrowUp' ? -1 : 1));
                    }}
                    aria-label={`Reorder ${displayName(r.name).full} (arrow up / down)`}
                    title="Drag or use ↑/↓ to reorder"
                    className={`flex h-5 w-4 cursor-grab items-center justify-center rounded text-faint hover:text-muted ${FOCUS_RING}`}
                  >
                    ⠿
                  </button>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <DisplayName value={r.name} className="font-mono text-text" />
                    {unknown && (
                      <span
                        className="shrink-0 rounded bg-warn-bg px-1 text-[10px] font-semibold text-warn"
                        title="Not found in any loaded file"
                      >
                        ?
                      </span>
                    )}
                  </span>
                  {r.cells.map((p, j) => (
                    <PresenceCell key={sources[j].id} p={p} label={labels[j]} />
                  ))}
                  <button
                    type="button"
                    aria-label={`Remove ${displayName(r.name).full} from this group`}
                    title="Remove from this group"
                    onClick={() => setExperiments(group.experiments.filter((x) => x !== r.name))}
                    className={`flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-panel hover:text-text ${FOCUS_RING}`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <ExperimentDrop group={group} onMessage={setMessage} />
      {message !== null && (
        <p role="alert" className="text-[11px] text-danger">
          {message}
        </p>
      )}
      {notices.map((n) => (
        <DuplicateNotice key={`${n.source.id}\u0000${n.experiment}`} notice={n} config={config} />
      ))}
    </div>
  );
}

/** Centre panel of the Config view: the selected group (spec Phase 4a). Self-contained. */
export function GroupEditor() {
  const config = useAppStore((s) => s.config.active.config);
  const baseline = useAppStore((s) => s.sources.baseline);
  const sources = useLoadedSources();
  const group = useSelectedGroup();
  const openModal = useAppStore((s) => s.openModal);
  if (group === null) {
    return (
      <section
        aria-label="Group"
        className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-panel p-6 text-center"
      >
        <p className="text-[14px] font-semibold text-text">No groups yet</p>
        <p className="text-[12px] text-muted">
          Add one with “+ New group” in the sidebar, or generate a config from your files.
        </p>
        <Button variant="primary" onClick={() => openModal({ kind: 'generate', step: 1 })}>
          Generate from files…
        </Button>
      </section>
    );
  }
  const index = config.groups.indexOf(group);
  const defaults = `${config.sources.repo.match === 'suffix' ? 'exact or run-id suffix' : typeof config.sources.repo.match === 'string' ? config.sources.repo.match : 'regex'} for repo tables, ${config.sources.wandb.match === 'suffix' ? 'exact or run-id suffix' : typeof config.sources.wandb.match === 'string' ? config.sources.wandb.match : 'regex'} for wandb exports`;

  return (
    <section
      aria-label={`Group ${displayName(group.name).full}`}
      className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-panel p-4"
    >
      <GroupHeader group={group} index={index} count={config.groups.length} />
      <div className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 text-[13px]">
        <span className="pt-1.5 text-muted">Baseline table</span>
        <BaselineTable group={group} sources={sources} />
        <span className="pt-1.5 text-muted">Match names</span>
        <MatchModeEditor
          key={group.name}
          label="Match names"
          inherit
          inheritHint={`Using the source defaults: ${defaults} (Sources tab).`}
          value={group.match}
          testName={group.experiments[0] ?? 'x'}
          count={baseline ? (regex) => regexMatchCount(config, group, baseline, regex) : undefined}
          onCommit={(mode) =>
            useAppStore.getState().updateConfig((c) =>
              updateGroup(c, group.name, (g) => {
                const next = { ...g };
                if (mode === undefined) delete next.match;
                else next.match = mode;
                return next;
              }),
            )
          }
        />
      </div>
      <div className="flex flex-col gap-2">
        <SectionTitle aside="drag or ←/→ to reorder">Metrics</SectionTitle>
        <MetricChips group={group} />
      </div>
      <ExperimentsTable group={group} sources={sources} />
    </section>
  );
}
