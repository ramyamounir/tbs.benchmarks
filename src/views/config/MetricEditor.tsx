import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { compileUserRegex } from '../../compare/safeRegex';
import { Button } from '../../components/ui/Button';
import { DropMenu } from '../../components/ui/DropMenu';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { VERDICT_GLYPH, VERDICT_LABEL } from '../../components/ui/verdict';
import { formatImpact, impactOfChange } from '../../config/impact';
import { TRANSFORM_KINDS } from '../../config/schema';
import { fmtNum } from '../../model/format';
import { describeTransform } from '../../model/transforms';
import type {
  Config,
  Direction,
  Group,
  Metric,
  SourceKind,
  Transform,
  Verdict,
} from '../../model/types';
import { useComparison, useLoadedSources, useVisibleRuns } from '../../state/selectors';
import { useAppStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { displayName } from '../../util/displayName';
import { COLUMN_MIME, hasType, readColumn } from './dnd';
import { DraftInput, FOCUS_RING, REGEX_DEBOUNCE_MS } from './fields';
import {
  clipTransform,
  columnSpec,
  decimalsError,
  defaultTransform,
  editTransforms,
  filterColumns,
  finiteError,
  formatTolerance,
  metricKeyError,
  metricUsage,
  overridesOf,
  parseFinite,
  sampleOf,
  sampleText,
  setColumn,
  setColumnSpec,
  setOverride,
  splitHeaderSuffix,
  textError,
  toleranceError,
  updateMetric,
  withUnits,
} from './metricModel';
import { columnsByKind, moveItem } from './model';
import { commitEdit, useSelectedGroup, useSelectedMetricKey } from './selection';

/*
 * Metric editor (spec Phase 4b, right panel of reference/04-config.png): key, label, units,
 * decimals, direction, tolerance with the live impact line, one column card per source kind
 * (column combobox, transform chips, sample line), group overrides and a live preview. Every input
 * follows the "Editor input rule" (Phase 4a): drafts are validated, only valid values are committed.
 */

/** Impact line debounce while typing (spec Phase 4b "Impact line"). */
const IMPACT_DEBOUNCE_MS = 150;
const KINDS: SourceKind[] = ['repo', 'wandb'];
const KIND_TITLE: Record<SourceKind, string> = { repo: 'Repo table', wandb: 'Wandb export' };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const VERDICT_TEXT: Record<Verdict, string> = {
  better: 'text-better',
  worse: 'text-worse',
  same: 'text-text',
  mismatch: 'text-text',
  missing: 'text-faint',
};

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

/** Commits an edit of metric `key` through one `updateConfig`. */
function editMetric(key: string, mutate: (m: Metric) => Metric): void {
  useAppStore.getState().updateConfig((c) => updateMetric(c, key, mutate));
}

function Heading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">{children}</h3>
      {aside}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[76px_minmax(0,1fr)] items-start gap-2">
      <span className="pt-1.5 text-[13px] text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Header with the `…` menu (Delete metric, with a confirmation naming what is affected). */
function MetricHeader({ metricKey, metric }: { metricKey: string; metric: Metric }) {
  const config = useAppStore((s) => s.config.active.config);
  const deleteMetric = useAppStore((s) => s.deleteMetric);
  const [confirm, setConfirm] = useState<string | null>(null);
  const usage = metricUsage(config, metricKey);
  return (
    <header className="flex flex-col gap-1">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <DisplayName value={metric.label} className="block text-[16px] font-semibold text-text" />
          <p className="text-[12px] text-muted">
            Metric · used in {plural(usage.groups.length, 'group', 'groups')}
          </p>
        </div>
        <DropMenu
          size="sm"
          variant="ghost"
          align="right"
          ariaLabel="Metric actions"
          label={<span aria-hidden="true">⋯</span>}
          items={[
            {
              key: 'delete',
              label: 'Delete metric…',
              onSelect: () => setConfirm(metricKey),
            },
          ]}
        />
      </div>
      {confirm === metricKey && (
        <div
          role="group"
          aria-label="Confirm delete"
          className="mt-1 flex flex-col gap-2 rounded-lg border border-warn bg-warn-bg px-3 py-2 text-[12px] text-text"
        >
          <p className="min-w-0">
            Delete <span className="font-mono">{metricKey}</span>?{' '}
            {usage.groups.length === 0
              ? 'No group uses it.'
              : `It is removed from ${plural(usage.groups.length, 'group', 'groups')}: `}
            {usage.groups.map((g, i) => (
              <span key={g}>
                {i > 0 && ', '}
                <DisplayName value={g} className="font-mono" />
              </span>
            ))}
            {usage.groups.length > 0 && '.'}
            {usage.charts.length > 0 && (
              <>
                {' '}
                {plural(usage.charts.length, 'chart is', 'charts are')} removed too:{' '}
                {usage.charts.map((c, i) => (
                  <span key={`${c}-${i}`}>
                    {i > 0 && ', '}
                    <DisplayName value={c} />
                  </span>
                ))}
                .
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" autoFocus onClick={() => deleteMetric(metricKey)}>
              Delete
            </Button>
            <Button size="sm" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * Tolerance + mode with the impact line. The impact compares the metric as it was when it was
 * selected (the snapshot) with the current definition plus the tolerance draft (debounced).
 */
function ToleranceField({
  metricKey,
  metric,
  snapshot,
}: {
  metricKey: string;
  metric: Metric;
  snapshot: Config;
}) {
  const config = useAppStore((s) => s.config.active.config);
  const baseline = useAppStore((s) => s.sources.baseline);
  const rowChoices = useAppStore((s) => s.session.rowChoices);
  const runs = useVisibleRuns();
  const value = String(metric.tolerance);
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  const errorId = useId();
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  const error = draft === value ? null : toleranceError(draft);
  const commit = () => {
    if (draft === value || toleranceError(draft) !== null) return;
    editMetric(metricKey, (m) => ({ ...m, tolerance: parseFinite(draft) ?? m.tolerance }));
  };

  const debounced = useDebounced(draft, IMPACT_DEBOUNCE_MS);
  const impact = useMemo(() => {
    if (baseline === null || runs.length === 0) return null;
    if (!Object.hasOwn(snapshot.metrics, metricKey)) return null;
    const t = toleranceError(debounced) === null ? parseFinite(debounced) : null;
    const next =
      t !== null && t !== metric.tolerance
        ? updateMetric(config, metricKey, (m) => ({ ...m, tolerance: t }))
        : config;
    const before = snapshot.metrics[metricKey];
    const after = next.metrics[metricKey];
    const same =
      JSON.stringify(before) === JSON.stringify(after) &&
      JSON.stringify(overridesOf(snapshot, metricKey)) ===
        JSON.stringify(overridesOf(next, metricKey));
    if (same) return null;
    const result = impactOfChange(snapshot, next, metricKey, baseline, runs, rowChoices);
    const tolChanged =
      before.tolerance !== after.tolerance || before.tolerance_mode !== after.tolerance_mode;
    return { result, text: formatImpact(result, tolChanged ? formatTolerance(before) : null) };
  }, [baseline, runs, snapshot, metricKey, debounced, metric.tolerance, config, rowChoices]);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 gap-2">
        <TextInput
          value={draft}
          onChange={setDraft}
          mono
          inputMode="decimal"
          aria-label="Tolerance"
          invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
          className="w-0 min-w-0 flex-1"
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape' && draft !== value) {
              e.stopPropagation();
              setDraft(value);
            }
          }}
        />
        <SegmentedControl<Metric['tolerance_mode']>
          dense
          ariaLabel="Tolerance mode"
          value={metric.tolerance_mode}
          onChange={(v) => editMetric(metricKey, (m) => ({ ...m, tolerance_mode: v }))}
          options={[
            { value: 'absolute', label: 'absolute' },
            { value: 'percent', label: '% of base' },
          ]}
        />
      </div>
      {error !== null && (
        <p id={errorId} className="text-[11px] text-danger">
          {error}
        </p>
      )}
      {impact !== null && (
        <p
          role="status"
          className={`text-[11px] ${impact.result.changed > 0 ? 'text-warn' : 'text-muted'}`}
        >
          {impact.text}
        </p>
      )}
      {(baseline === null || runs.length === 0) && (
        <p className="text-[11px] text-faint">Load a baseline and a run to see verdict changes</p>
      )}
    </div>
  );
}

/** A header with its `|align right` / `|hidden` suffix dimmed (kept: it is part of the header). */
function HeaderText({ value }: { value: string }) {
  const [name, suffix] = splitHeaderSuffix(value);
  return (
    <span className="flex min-w-0 font-mono">
      <DisplayName value={name} />
      {suffix !== '' && <DisplayName value={suffix} className="shrink-0 text-faint" />}
    </span>
  );
}

/**
 * Column combobox: free text with a filtered list of the loaded columns of one kind. The draft
 * shows the sanitised header; picking an option commits the real header, a typed draft is
 * committed on Enter / blur when it is a valid string. Red when the column is in no loaded table.
 */
function ColumnCombobox({
  value,
  options,
  onCommit,
  label,
  notFound,
}: {
  value: string;
  options: readonly string[];
  onCommit(column: string): void;
  label: string;
  notFound: boolean;
}) {
  const shown = displayName(value).full;
  const [draft, setDraft] = useState(shown);
  const [prev, setPrev] = useState(shown);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const errorId = useId();
  if (prev !== shown) {
    setPrev(shown);
    setDraft(shown);
  }
  const filtered = useMemo(
    () => filterColumns(options, draft === shown ? '' : draft),
    [options, draft, shown],
  );
  const draftError = draft === shown ? null : textError(draft, { required: true });

  const pick = (column: string) => {
    setOpen(false);
    setActive(-1);
    setDraft(displayName(column).full);
    if (column !== value) onCommit(column);
  };
  const commitDraft = () => {
    if (draft === shown || textError(draft, { required: true }) !== null) return;
    onCommit(draft);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      const n = filtered.length;
      if (n === 0) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && active < filtered.length) pick(filtered[active]);
      else {
        setOpen(false);
        commitDraft();
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      } else if (draft !== shown) {
        e.stopPropagation();
        setDraft(shown);
      }
    }
  };

  const message = draftError ?? (notFound ? 'Not found in the loaded files' : null);
  return (
    <div className="relative flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0">
        <TextInput
          value={draft}
          onChange={(v) => {
            setDraft(v);
            setOpen(true);
            setActive(-1);
          }}
          mono
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          invalid={message !== null}
          aria-describedby={message !== null ? errorId : undefined}
          className="w-0 min-w-0 flex-1 pr-7 text-[12px]"
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            commitDraft();
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen((o) => !o);
          }}
          className="-ml-7 w-7 shrink-0 text-[10px] text-muted"
        >
          ▾
        </button>
      </div>
      {open && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} options`}
          className="absolute top-9 right-0 left-0 z-30 max-h-60 overflow-y-auto rounded-lg border border-border bg-panel py-1 text-[12px] shadow-lg"
        >
          {filtered.map((c, i) => (
            <li
              key={c}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              className={`flex min-w-0 cursor-pointer px-2.5 py-1 hover:bg-row-alt ${
                i === active ? 'bg-accent-bg' : ''
              } ${c === value ? 'font-semibold' : ''}`}
            >
              <HeaderText value={c} />
            </li>
          ))}
        </ul>
      )}
      {message !== null && (
        <p id={errorId} className="text-[11px] text-danger">
          {message}
        </p>
      )}
    </div>
  );
}

/** `regex_replace` pattern: 300 ms after typing stops, compiled; committed only when valid. */
function RegexPatternField({ value, onCommit }: { value: string; onCommit(p: string): void }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  const check = useEffectEvent((pattern: string) => {
    if (textError(pattern) !== null) {
      setError(textError(pattern));
      return;
    }
    const compiled = compileUserRegex(pattern, 'g');
    if ('error' in compiled) {
      setError(compiled.error);
      return;
    }
    setError(null);
    if (pattern !== value) onCommit(pattern);
  });
  useEffect(() => {
    const t = setTimeout(() => check(draft), REGEX_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft]);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <TextInput
        value={draft}
        onChange={setDraft}
        mono
        aria-label="Pattern"
        placeholder="regex"
        invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        className="w-full text-[12px]"
      />
      {error !== null && (
        <p id={errorId} className="text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Parameters of one transform (click on a chip). */
function TransformParams({ t, onChange }: { t: Transform; onChange(next: Transform): void }) {
  const row = (label: string, child: ReactNode) => (
    <div className="grid min-w-0 grid-cols-[84px_minmax(0,1fr)] items-start gap-2">
      <span className="pt-1.5 text-[12px] text-muted">{label}</span>
      {child}
    </div>
  );
  switch (t.kind) {
    case 'strip_prefix':
    case 'strip_suffix':
      return row(
        t.kind === 'strip_prefix' ? 'Prefix' : 'Suffix',
        <DraftInput
          mono
          label={t.kind === 'strip_prefix' ? 'Prefix' : 'Suffix'}
          value={t.value}
          validate={(d) => textError(d)}
          onCommit={(d) => onChange({ kind: t.kind, value: d })}
        />,
      );
    case 'regex_replace':
      return (
        <>
          {row(
            'Pattern',
            <RegexPatternField
              value={t.pattern}
              onCommit={(p) => onChange({ ...t, pattern: p })}
            />,
          )}
          {row(
            'Replacement',
            <DraftInput
              mono
              label="Replacement"
              value={t.replacement}
              validate={(d) => textError(d)}
              onCommit={(d) => onChange({ ...t, replacement: d })}
            />,
          )}
        </>
      );
    case 'round':
      return row(
        'Decimals',
        <DraftInput
          mono
          label="Round decimals"
          value={String(t.decimals)}
          validate={decimalsError}
          onCommit={(d) => onChange({ kind: 'round', decimals: Number(d.trim()) })}
        />,
      );
    case 'scale':
      return row(
        'Factor',
        <DraftInput
          mono
          label="Scale factor"
          value={String(t.factor)}
          validate={(d) => finiteError(d)}
          onCommit={(d) => onChange({ kind: 'scale', factor: parseFinite(d) ?? t.factor })}
        />,
      );
    case 'clip': {
      const min = t.min === undefined ? '' : String(t.min);
      const max = t.max === undefined ? '' : String(t.max);
      return (
        <>
          {row(
            'Min',
            <DraftInput
              mono
              label="Clip min"
              placeholder="none"
              value={min}
              validate={(d) => finiteError(d, true)}
              onCommit={(d) => onChange(clipTransform(d, max))}
            />,
          )}
          {row(
            'Max',
            <DraftInput
              mono
              label="Clip max"
              placeholder="none"
              value={max}
              validate={(d) => finiteError(d, true)}
              onCommit={(d) => onChange(clipTransform(min, d))}
            />,
          )}
        </>
      );
    }
    default:
      return <p className="text-[12px] text-muted">No parameters</p>;
  }
}

/** One column card (`REPO TABLE` / `WANDB EXPORT`): column, transforms, sample line, drop target. */
function ColumnCard({
  metricKey,
  metric,
  kind,
  columns,
  group,
}: {
  metricKey: string;
  metric: Metric;
  kind: SourceKind;
  columns: readonly string[];
  group: Group | null;
}) {
  const sources = useLoadedSources();
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const spec = columnSpec(metric, kind);
  const sample = useMemo(
    () => sampleOf(sources, metric, metricKey, kind, group),
    [sources, metric, metricKey, kind, group],
  );
  const loadedOfKind = sources.some((s) => s.kind === kind);
  const transforms = spec?.transforms ?? [];
  const setTransforms = (next: (l: Transform[]) => Transform[]) =>
    editMetric(metricKey, (m) => editTransforms(m, kind, next));
  const editIndex = editing !== null && editing < transforms.length ? editing : null;

  return (
    <div
      aria-label={`${KIND_TITLE[kind]} column`}
      role="group"
      className={`flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5 ${
        over ? 'border-accent bg-accent-bg' : 'border-border bg-row-alt'
      }`}
      onDragOver={(e) => {
        if (!hasType(e.dataTransfer, COLUMN_MIME)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!hasType(e.dataTransfer, COLUMN_MIME)) return;
        e.preventDefault();
        const col = readColumn(e.dataTransfer);
        if (!col) return;
        if (col.kind !== kind) {
          setMessage(`That is a ${col.kind} column; drop it on the ${col.kind} card`);
          return;
        }
        setMessage(null);
        editMetric(metricKey, (m) => setColumn(m, kind, col.column));
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="rounded bg-border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
          {KIND_TITLE[kind]}
        </span>
        {spec && (
          <button
            type="button"
            className={`text-[11px] text-muted hover:text-text ${FOCUS_RING}`}
            onClick={() => editMetric(metricKey, (m) => setColumnSpec(m, kind, null))}
          >
            Remove column
          </button>
        )}
      </div>
      {spec ? (
        <ColumnCombobox
          label={`${KIND_TITLE[kind]} column`}
          value={spec.column}
          options={columns}
          notFound={loadedOfKind && !columns.includes(spec.column)}
          onCommit={(c) => editMetric(metricKey, (m) => setColumn(m, kind, c))}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[12px] text-faint">
            No {kind} column · pick one or drop it from “Columns”
          </p>
          <ColumnCombobox
            label={`${KIND_TITLE[kind]} column`}
            value=""
            options={columns}
            notFound={false}
            onCommit={(c) => editMetric(metricKey, (m) => setColumn(m, kind, c))}
          />
        </div>
      )}
      {spec && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {transforms.map((t, i) => (
            <span
              key={i}
              className={`inline-flex max-w-full min-w-0 items-center rounded border text-[11px] ${
                editIndex === i ? 'border-accent bg-accent-bg' : 'border-border bg-panel'
              }`}
            >
              <button
                type="button"
                aria-expanded={editIndex === i}
                aria-label={`Transform ${i + 1}: ${displayName(describeTransform(t)).full}`}
                onClick={() => setEditing(editIndex === i ? null : i)}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
                  e.preventDefault();
                  const to = e.key === 'ArrowLeft' ? i - 1 : i + 1;
                  if (to < 0 || to >= transforms.length) return;
                  setTransforms((l) => moveItem(l, i, to));
                  setEditing(to);
                }}
                className={`min-w-0 truncate rounded-l px-1.5 py-0.5 font-mono text-text ${FOCUS_RING}`}
              >
                <DisplayName value={describeTransform(t)} max={40} />
              </button>
              <button
                type="button"
                aria-label={`Remove transform ${i + 1}`}
                onClick={() => {
                  setEditing(null);
                  setTransforms((l) => l.filter((_, j) => j !== i));
                }}
                className={`rounded-r px-1 text-faint hover:text-text ${FOCUS_RING}`}
              >
                ×
              </button>
            </span>
          ))}
          <DropMenu
            size="sm"
            variant="ghost"
            ariaLabel={`Add a transform to the ${kind} column`}
            label="+ transform"
            items={TRANSFORM_KINDS.map((k) => ({
              key: k,
              label: <span className="font-mono">{k}</span>,
              onSelect: () => {
                setTransforms((l) => [...l, defaultTransform(k, metric)]);
                setEditing(transforms.length);
              },
            }))}
          />
        </div>
      )}
      {spec && editIndex !== null && (
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-panel p-2">
          <TransformParams
            key={`${editIndex}-${transforms[editIndex].kind}`}
            t={transforms[editIndex]}
            onChange={(next) => setTransforms((l) => l.map((x, j) => (j === editIndex ? next : x)))}
          />
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={editIndex === 0}
              onClick={() => {
                setTransforms((l) => moveItem(l, editIndex, editIndex - 1));
                setEditing(editIndex - 1);
              }}
            >
              ← Move
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={editIndex >= transforms.length - 1}
              onClick={() => {
                setTransforms((l) => moveItem(l, editIndex, editIndex + 1));
                setEditing(editIndex + 1);
              }}
            >
              Move →
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Done
            </Button>
          </div>
        </div>
      )}
      {spec && (
        <p className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-faint">
          {sample === null ? (
            <span>
              {loadedOfKind ? 'No value in the loaded files' : `No ${kind} source loaded`}
            </span>
          ) : (
            <>
              <span className="flex min-w-0">
                “<DisplayName value={sample.raw} max={24} />”
              </span>
              <span aria-hidden="true">→</span>
              <span className="sr-only">becomes</span>
              <DisplayName value={sampleText(sample.value)} max={24} className="text-muted" />
            </>
          )}
        </p>
      )}
      {message !== null && (
        <p role="alert" className="text-[11px] text-danger">
          {message}
        </p>
      )}
    </div>
  );
}

/** "Override in <group>: wandb → LM_2/…" rows with Edit / remove, and "+ Add group override". */
function Overrides({
  metricKey,
  columns,
}: {
  metricKey: string;
  columns: Record<SourceKind, string[]>;
}) {
  const config = useAppStore((s) => s.config.active.config);
  const rows = overridesOf(config, metricKey);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [group, setGroup] = useState('');
  const [kind, setKind] = useState<SourceKind>('wandb');
  const [column, setColumnDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const errorId = useId();
  const groupName = config.groups.some((g) => g.name === group)
    ? group
    : (config.groups[0]?.name ?? '');
  const columnError = column === '' ? null : textError(column, { required: true });

  const add = () => {
    if (groupName === '' || column === '' || columnError !== null) return;
    const err = commitEdit((c) => setOverride(c, groupName, metricKey, kind, column));
    setMessage(err);
    if (err === null) {
      setAdding(false);
      setColumnDraft('');
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Heading>Overrides</Heading>
      {rows.length === 0 && <p className="text-[12px] text-faint">No group overrides</p>}
      {rows.map((r) => {
        const id = `${r.group}\u0000${r.kind}`;
        return (
          <div
            key={id}
            className="flex min-w-0 flex-col gap-1 rounded-lg border border-dashed border-border px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <p className="flex min-w-0 flex-1 gap-1 text-[13px] font-medium text-text">
                <span className="shrink-0">Override in</span>
                <DisplayName value={r.group} className="font-mono" />
              </p>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={editing === id}
                onClick={() => setEditing(editing === id ? null : id)}
              >
                Edit
              </Button>
              <button
                type="button"
                aria-label={`Remove the ${r.kind} override in ${displayName(r.group).full}`}
                onClick={() =>
                  setMessage(commitEdit((c) => setOverride(c, r.group, metricKey, r.kind, null)))
                }
                className={`rounded px-1 text-faint hover:text-text ${FOCUS_RING}`}
              >
                ×
              </button>
            </div>
            {editing === id ? (
              <ColumnCombobox
                label={`Override column in ${displayName(r.group).full}`}
                value={r.column}
                options={columns[r.kind]}
                notFound={columns[r.kind].length > 0 && !columns[r.kind].includes(r.column)}
                onCommit={(c) =>
                  setMessage(commitEdit((cfg) => setOverride(cfg, r.group, metricKey, r.kind, c)))
                }
              />
            ) : (
              <p className="flex min-w-0 gap-1 font-mono text-[11px] text-muted">
                <span className="shrink-0">{r.kind} →</span>
                <HeaderText value={r.column} />
              </p>
            )}
          </div>
        );
      })}
      {adding ? (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border px-3 py-2">
          <div className="flex min-w-0 gap-2">
            <Select
              mono
              aria-label="Override group"
              className="w-0 min-w-0 flex-1"
              value={groupName}
              onChange={setGroup}
              options={config.groups.map((g) => ({
                value: g.name,
                label: displayName(g.name).text,
              }))}
            />
            <Select<SourceKind>
              aria-label="Override source kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'repo', label: 'repo' },
                { value: 'wandb', label: 'wandb' },
              ]}
            />
          </div>
          <TextInput
            value={column}
            onChange={setColumnDraft}
            mono
            list={`${errorId}-list`}
            aria-label="Override column"
            placeholder="Column, e.g. LM_2/overall/avg_rotation_error"
            invalid={columnError !== null}
            aria-describedby={columnError !== null ? errorId : undefined}
            className="w-full text-[12px]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
          <datalist id={`${errorId}-list`}>
            {columns[kind].slice(0, 500).map((c) => (
              <option key={c} value={displayName(c).full} />
            ))}
          </datalist>
          {columnError !== null && (
            <p id={errorId} className="text-[11px] text-danger">
              {columnError}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={groupName === '' || column === '' || columnError !== null}
              onClick={add}
            >
              Add override
            </Button>
            <Button size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          disabled={config.groups.length === 0}
          onClick={() => setAdding(true)}
        >
          + Add group override
        </Button>
      )}
      {message !== null && (
        <p role="alert" className="text-[11px] text-danger">
          {message}
        </p>
      )}
    </div>
  );
}

/** First 3 experiments of the selected group (or the first group listing the metric). */
function LivePreview({ metricKey, metric }: { metricKey: string; metric: Metric }) {
  const comparison = useComparison();
  const selected = useSelectedGroup();
  const runs = useAppStore((s) => s.sources.runs);
  const visible = runs.map((r, i) => ({ r, i })).filter((x) => !x.r.hidden);
  if (comparison === null) {
    return (
      <div className="flex flex-col gap-2">
        <Heading>Live preview</Heading>
        <p className="text-[12px] text-faint">Load a baseline to preview values</p>
      </div>
    );
  }
  const entry =
    comparison.groups.find(
      (g) => g.group.name === selected?.name && g.group.metrics.includes(metricKey),
    ) ?? comparison.groups.find((g) => g.group.metrics.includes(metricKey));
  const rows = entry ? entry.experiments.slice(0, 3) : [];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Heading
        aside={
          entry ? (
            <DisplayName value={entry.group.name} className="font-mono text-[11px] text-faint" />
          ) : undefined
        }
      >
        Live preview
      </Heading>
      {rows.length === 0 ? (
        <p className="text-[12px] text-faint">No group with experiments uses this metric</p>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-0 border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-faint">
                <th className="text-left font-normal">
                  <span className="sr-only">Experiment</span>
                </th>
                <th className="px-1 text-right font-normal">base</th>
                {visible.map(({ r, i }) => (
                  <th key={r.id} className="px-1 text-right font-normal">
                    run {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const first = visible.find(({ r }) => Object.hasOwn(row.cells, r.id));
                const base = first ? (row.cells[first.r.id][metricKey]?.base ?? null) : null;
                return (
                  <tr key={row.name}>
                    <td className="max-w-[140px] py-0.5 pr-2 text-muted">
                      <DisplayName value={row.name} className="block" />
                    </td>
                    <td className="px-1 text-right text-text tabular-nums">
                      {fmtNum(base, metric.decimals)}
                    </td>
                    {visible.map(({ r }) => {
                      const cell = Object.hasOwn(row.cells, r.id)
                        ? row.cells[r.id][metricKey]
                        : undefined;
                      const verdict: Verdict = cell?.verdict ?? 'missing';
                      return (
                        <td
                          key={r.id}
                          className={`px-1 text-right whitespace-nowrap tabular-nums ${VERDICT_TEXT[verdict]}`}
                          title={VERDICT_LABEL[verdict]}
                        >
                          {cell?.value === null || cell === undefined
                            ? '—'
                            : fmtNum(cell.value, metric.decimals)}
                          {verdict !== 'missing' && verdict !== 'same' && (
                            <span aria-hidden="true" className="ml-0.5 text-[9px]">
                              {VERDICT_GLYPH[verdict]}
                            </span>
                          )}
                          <span className="sr-only"> {VERDICT_LABEL[verdict]}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The right panel of the Config view. */
export function MetricEditor() {
  const config = useAppStore((s) => s.config.active.config);
  const activeId = useAppStore((s) => s.config.active.id);
  const renameMetric = useAppStore((s) => s.renameMetric);
  const key = useSelectedMetricKey();
  const group = useSelectedGroup();
  const sources = useLoadedSources();
  const columns = useMemo(() => columnsByKind(sources), [sources]);
  // The impact line compares against the metric as it was when it was selected.
  const [snap, setSnap] = useState({ id: activeId, key, config });
  if (snap.id !== activeId || snap.key !== key) setSnap({ id: activeId, key, config });

  if (key === null) {
    return (
      <section
        aria-label="Metric"
        className="flex min-h-0 min-w-0 flex-col items-center justify-center rounded-xl border border-border bg-panel p-6 text-center text-[12px] text-muted"
      >
        No metric selected · add one with “+ New metric” in the sidebar
      </section>
    );
  }
  const metric = config.metrics[key];
  const direction = (d: Direction) => editMetric(key, (m) => ({ ...m, direction: d }));

  return (
    <section
      aria-label={`Metric ${key}`}
      className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-panel p-4"
    >
      <MetricHeader metricKey={key} metric={metric} />
      <div className="flex min-w-0 flex-col gap-2.5">
        <Field label="Key">
          <DraftInput
            mono
            label="Metric key"
            value={key}
            validate={(d) => metricKeyError(config, key, d)}
            onCommit={(d) => renameMetric(key, d)}
          />
        </Field>
        <Field label="Label">
          <DraftInput
            label="Label"
            value={metric.label}
            validate={(d) => textError(d, { required: true })}
            onCommit={(d) => editMetric(key, (m) => ({ ...m, label: d }))}
          />
        </Field>
        <div className="grid min-w-0 grid-cols-[76px_minmax(0,1fr)_auto_64px] items-start gap-2">
          <span className="pt-1.5 text-[13px] text-muted">Units</span>
          <DraftInput
            mono
            label="Units"
            value={metric.units ?? ''}
            validate={(d) => textError(d)}
            onCommit={(d) => editMetric(key, (m) => withUnits(m, d))}
          />
          <span className="pt-1.5 text-[13px] text-muted">Decimals</span>
          <DraftInput
            mono
            label="Decimals"
            value={String(metric.decimals)}
            validate={decimalsError}
            onCommit={(d) => editMetric(key, (m) => ({ ...m, decimals: Number(d.trim()) }))}
          />
        </div>
        <Field label="Direction">
          <SegmentedControl<Direction>
            ariaLabel="Direction"
            value={metric.direction}
            onChange={direction}
            options={[
              { value: 'higher', label: '↑ Higher' },
              { value: 'lower', label: '↓ Lower' },
              { value: 'match', label: '= Match' },
            ]}
          />
        </Field>
        <Field label="Tolerance">
          <ToleranceField metricKey={key} metric={metric} snapshot={snap.config} />
        </Field>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Heading>Columns</Heading>
        {KINDS.map((kind) => (
          <ColumnCard
            key={kind}
            metricKey={key}
            metric={metric}
            kind={kind}
            columns={columns[kind]}
            group={group}
          />
        ))}
      </div>
      <Overrides metricKey={key} columns={columns} />
      <LivePreview metricKey={key} metric={metric} />
    </section>
  );
}
