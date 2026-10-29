import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { LIMITS } from '../../config/schema';
import type { SourceKind } from '../../model/types';
import { useFilesModel, useLoadedSources } from '../../state/selectors';
import { useAppStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { displayName } from '../../util/displayName';
import { EXPERIMENTS_MIME, GROUP_MIME, hasType, readExperiments } from '../../views/config/dnd';
import { DraftInput, FOCUS_RING, MatchModeEditor } from '../../views/config/fields';
import {
  addExperiments,
  listSeparator,
  moveItem,
  newGroup,
  newMetric,
  unassignedSourceLabels,
} from '../../views/config/model';
import {
  commitEdit,
  selectGroup,
  selectMetric,
  useSelectedGroup,
  useSelectedMetricKey,
} from '../../views/config/selection';
import { PanelTabs, TabPanel } from '../ui/PanelTabs';
import { ConfigCard } from './ConfigCard';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function InlineError({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <p role="alert" className="mt-1 text-[11px] text-danger">
      {text}
    </p>
  );
}

/** GROUPS tab: ordered groups (drag or ↑/↓ on the handle to reorder), drop experiments on a row. */
function GroupsList() {
  const groups = useAppStore((s) => s.config.active.config.groups);
  const baseline = useAppStore((s) => s.sources.baseline);
  const selected = useSelectedGroup();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());

  const move = (name: string, to: number) => {
    const from = groups.findIndex((g) => g.name === name);
    if (from < 0 || to < 0 || to >= groups.length || from === to) return;
    useAppStore.getState().updateConfig((c) => ({ ...c, groups: moveItem(c.groups, from, to) }));
    requestAnimationFrame(() => handles.current.get(name)?.focus());
  };

  const onDrop = (e: DragEvent, name: string, index: number) => {
    setOver(null);
    if (hasType(e.dataTransfer, GROUP_MIME)) {
      e.preventDefault();
      move(e.dataTransfer.getData(GROUP_MIME), index);
    } else if (hasType(e.dataTransfer, EXPERIMENTS_MIME)) {
      e.preventDefault();
      const names = readExperiments(e.dataTransfer);
      setError(commitEdit((c) => addExperiments(c, name, names)));
      useAppStore.getState().setSession({ config: { selectedExperiments: [] } });
    }
  };

  return (
    <div>
      <ol aria-label="Groups" className="flex flex-col">
        {groups.map((g, i) => {
          const isSel = selected?.name === g.name;
          return (
            <li
              key={`${g.name}\u0000${i}`}
              className={`group flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 pl-1 ${
                isSel ? 'bg-accent-bg' : over === g.name ? 'bg-row-alt' : ''
              } ${dragging === g.name ? 'opacity-50' : ''}`}
              onDragOver={(e) => {
                if (
                  !hasType(e.dataTransfer, GROUP_MIME) &&
                  !hasType(e.dataTransfer, EXPERIMENTS_MIME)
                )
                  return;
                e.preventDefault();
                setOver(g.name);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => onDrop(e, g.name, i)}
            >
              <button
                ref={(el) => {
                  if (el) handles.current.set(g.name, el);
                  else handles.current.delete(g.name);
                }}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(GROUP_MIME, g.name);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragging(g.name);
                }}
                onDragEnd={() => setDragging(null)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                  e.preventDefault();
                  move(g.name, i + (e.key === 'ArrowUp' ? -1 : 1));
                }}
                aria-label={`Reorder group ${displayName(g.name).full} (arrow up / down)`}
                title="Drag or use ↑/↓ to reorder"
                className={`flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded text-[12px] text-faint hover:text-muted ${FOCUS_RING}`}
              >
                ⠿
              </button>
              <button
                type="button"
                aria-current={isSel || undefined}
                onClick={() => selectGroup(g.name)}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded text-left ${FOCUS_RING}`}
              >
                <DisplayName
                  value={g.name}
                  className={`flex-1 font-mono text-[13px] ${isSel ? 'text-accent' : 'text-text'}`}
                />
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  {g.experiments.length}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className={`mt-1 rounded px-1 text-[13px] font-medium text-accent hover:underline ${FOCUS_RING}`}
        onClick={() => {
          let created: string | null = null;
          setError(
            commitEdit((c) => {
              const r = newGroup(c, baseline);
              if ('config' in r) created = r.config.groups[r.config.groups.length - 1].name;
              return r;
            }),
          );
          if (created !== null) selectGroup(created);
        }}
      >
        + New group
      </button>
      <InlineError text={error} />
    </div>
  );
}

/** METRICS tab: key, label and the number of groups using each metric. */
function MetricsList() {
  const config = useAppStore((s) => s.config.active.config);
  const selected = useSelectedMetricKey();
  const [error, setError] = useState<string | null>(null);
  const keys = Object.keys(config.metrics);
  return (
    <div>
      <ul aria-label="Metrics" className="flex flex-col">
        {keys.map((key) => {
          const m = config.metrics[key];
          const used = config.groups.filter((g) => g.metrics.includes(key)).length;
          const isSel = key === selected;
          return (
            <li key={key}>
              <button
                type="button"
                aria-current={isSel || undefined}
                onClick={() => selectMetric(key)}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left ${
                  isSel ? 'bg-accent-bg' : 'hover:bg-row-alt'
                } ${FOCUS_RING}`}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={`truncate font-mono text-[12px] ${isSel ? 'text-accent' : 'text-text'}`}
                  >
                    {key}
                  </span>
                  <DisplayName value={m.label} className="text-[11px] text-muted" />
                </span>
                <span
                  className="shrink-0 text-[11px] text-faint"
                  title={`Used in ${plural(used, 'group', 'groups')}`}
                >
                  {used === 0 ? 'unused' : `in ${used}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className={`mt-1 rounded px-1 text-[13px] font-medium text-accent hover:underline ${FOCUS_RING}`}
        onClick={() => {
          let created: string | undefined;
          setError(
            commitEdit((c) => {
              const r = newMetric(c);
              created = r.key;
              return r;
            }),
          );
          if (created !== undefined) selectMetric(created);
        }}
      >
        + New metric
      </button>
      <InlineError text={error} />
    </div>
  );
}

const KIND_TITLE: Record<SourceKind, string> = { repo: 'Repo tables', wandb: 'Wandb exports' };

/** SOURCES tab: per kind the id column, the default name matching and the loaded sources. */
function SourcesList() {
  const sources = useAppStore((s) => s.config.active.config.sources);
  const loaded = useLoadedSources();
  const baselineId = useAppStore((s) => s.sources.baseline?.id ?? null);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const kinds: SourceKind[] = ['repo', 'wandb'];
  return (
    <div className="flex flex-col gap-4">
      {kinds.map((kind) => {
        const of = loaded.filter((s) => s.kind === kind);
        return (
          <section key={kind} aria-label={KIND_TITLE[kind]} className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              {KIND_TITLE[kind]}
            </h3>
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Id column
              <DraftInput
                label={`${kind} id column`}
                value={sources[kind].id_column}
                mono
                validate={(d) =>
                  d.trim() === ''
                    ? 'An id column is required'
                    : d.length > LIMITS.stringLength
                      ? `At most ${LIMITS.stringLength} characters`
                      : null
                }
                onCommit={(d) =>
                  updateConfig((c) => ({
                    ...c,
                    sources: { ...c.sources, [kind]: { ...c.sources[kind], id_column: d } },
                  }))
                }
              />
            </label>
            <div className="flex flex-col gap-1 text-[12px] text-muted">
              Match names
              <MatchModeEditor
                key={kind}
                label={`${kind} name matching`}
                value={sources[kind].match}
                testName="x"
                onCommit={(mode) => {
                  if (mode === undefined) return;
                  updateConfig((c) => ({
                    ...c,
                    sources: { ...c.sources, [kind]: { ...c.sources[kind], match: mode } },
                  }));
                }}
              />
            </div>
            {of.length === 0 ? (
              <p className="text-[11px] text-faint">None loaded</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {of.map((s) => (
                  <li key={s.id} className="flex min-w-0 items-center gap-1.5 text-[12px]">
                    <DisplayName value={s.label} className="font-mono text-text" />
                    {s.id === baselineId && (
                      <span className="shrink-0 rounded bg-row-alt px-1 text-[10px] font-semibold text-muted">
                        BASE
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Amber "n experiments not in any group · Found in … · Review →" card. */
function UnassignedCard() {
  const model = useFilesModel();
  const sources = useLoadedSources();
  const setSession = useAppStore((s) => s.setSession);
  if (model.unassigned === 0) return null;
  const labels = unassignedSourceLabels(model, sources);
  return (
    <div className="mx-4 my-4 rounded-lg border border-warn bg-warn-bg px-3 py-2.5" role="status">
      <p className="text-[13px] font-medium text-text">
        <span aria-hidden="true" className="text-warn">
          ⚠{' '}
        </span>
        {plural(model.unassigned, 'experiment', 'experiments')} not in any group
      </p>
      {labels.length > 0 && (
        <p className="mt-0.5 flex min-w-0 flex-wrap gap-x-1 text-[11px] text-muted">
          Found in{' '}
          {labels.map((l, i) => (
            // Inline flow inside the flex item, so the leading space of " and" is kept.
            <span key={i} className="min-w-0 break-all">
              <DisplayName value={l} className="font-mono" />
              {listSeparator(i, labels.length)}
            </span>
          ))}
        </p>
      )}
      <button
        type="button"
        className={`mt-1.5 rounded text-[13px] font-medium text-accent hover:underline ${FOCUS_RING}`}
        onClick={() => {
          setSession({ config: { filesTab: 'experiments', filesFilter: 'unassigned' } });
          document.getElementById('config-files-panel')?.focus();
        }}
      >
        Review →
      </button>
    </div>
  );
}

const TABS = [
  { id: 'groups' as const, label: 'Groups' },
  { id: 'metrics' as const, label: 'Metrics' },
  { id: 'sources' as const, label: 'Sources' },
];

/** Sidebar of the Config view: the Config card, GROUPS / METRICS / SOURCES and the review card. */
export function ConfigSidebar() {
  const tab = useAppStore((s) => s.session.config.tab);
  const setSession = useAppStore((s) => s.setSession);
  return (
    <>
      <ConfigCard />
      <section className="border-b border-border px-4 py-4">
        <PanelTabs
          tabs={TABS}
          value={tab}
          onChange={(t) => setSession({ config: { tab: t } })}
          ariaLabel="Config parts"
          idPrefix="config-side"
        />
        <TabPanel idPrefix="config-side" id={tab} className="pt-3">
          {tab === 'groups' && <GroupsList />}
          {tab === 'metrics' && <MetricsList />}
          {tab === 'sources' && <SourcesList />}
        </TabPanel>
      </section>
      <UnassignedCard />
    </>
  );
}
