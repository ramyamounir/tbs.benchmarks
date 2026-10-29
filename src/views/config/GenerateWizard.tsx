import { useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Modal } from '../../components/ui/Modal';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { Toggle } from '../../components/ui/Toggle';
import { headersOf, type GenerateSources } from '../../config/generate';
import type { Direction, Source, SourceKind } from '../../model/types';
import { useAppStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { displayName } from '../../util/displayName';
import { FOCUS_RING } from './fields';
import {
  buildConfig,
  initialWizardState,
  planNameErrors,
  rowForColumn,
  tableSummaries,
  unmatchedFor,
  variantColumns,
  wandbOnlyCount,
  withRowColumn,
  type WizardRow,
  type WizardState,
} from './generateModel';
import { parseFinite, toleranceError } from './metricModel';

/*
 * "Generate config from files" (spec Phase 4b, reference/07-generate-config.png): 1 Sources →
 * 2 Metrics → 3 Groups. The step lives in `ui.modal.step`; the wizard's choices are local state
 * (nothing reaches the config until "Create config", which adds a new saved entry).
 */

type Step = 1 | 2 | 3;
const NONE = '\u0000none';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Sources' },
  { n: 2, label: 'Metrics' },
  { n: 3, label: 'Groups' },
];

function Stepper({ step, from, to }: { step: Step; from: string; to: string[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <ol className="flex min-w-0 items-center gap-2 sm:gap-3" aria-label="Steps">
        {STEPS.map((s, i) => {
          const done = s.n < step;
          const current = s.n === step;
          return (
            <li
              key={s.n}
              className="flex items-center gap-2 sm:gap-3"
              aria-current={current ? 'step' : undefined}
            >
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={`h-px w-4 sm:w-14 ${done || current ? 'bg-accent' : 'bg-border'}`}
                />
              )}
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-[12px] ${
                    done || current
                      ? 'border-accent bg-accent text-panel'
                      : 'border-border text-muted'
                  }`}
                >
                  {done ? '✓' : s.n}
                </span>
                <span
                  className={`text-[13px] ${current ? 'font-semibold text-text' : 'text-muted max-sm:sr-only'}`}
                >
                  {s.label}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="ml-auto flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-faint">
        <DisplayName value={from} max={40} />
        <span aria-hidden="true">→</span>
        <span className="sr-only">compared with</span>
        <DisplayName value={to.length === 0 ? 'no runs' : to.join(', ')} max={60} />
      </p>
    </div>
  );
}

function SourceLine({ source, aside }: { source: Source; aside?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <DisplayName value={source.label} className="font-mono text-[12px]" />
      <span className="shrink-0 rounded bg-row-alt px-1.5 text-[10px] text-muted uppercase">
        {source.kind}
      </span>
      {aside}
    </span>
  );
}

/** Step 1: the baseline (left) and which runs feed the column matching (right). */
function SourcesStep({
  baseline,
  runs,
  selected,
  onToggle,
}: {
  baseline: Source;
  runs: Source[];
  selected: string[];
  onToggle(id: string, on: boolean): void;
}) {
  const tables = (s: Source) => plural(s.tables.length, 'table', 'tables');
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">Baseline</h3>
        <SourceLine
          source={baseline}
          aside={<span className="shrink-0 text-[11px] text-faint">{tables(baseline)}</span>}
        />
        <p className="text-[11px] text-muted">
          {baseline.kind === 'repo'
            ? 'One group per baseline table, with that table’s experiments'
            : 'A wandb baseline gives one group with its experiments'}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">Runs</h3>
        {runs.length === 0 && (
          <p className="text-[12px] text-faint">
            No run loaded · columns come from the baseline only
          </p>
        )}
        {runs.map((r) => (
          <Checkbox
            key={r.id}
            checked={selected.includes(r.id)}
            onChange={(on) => onToggle(r.id, on)}
            label={<SourceLine source={r} />}
            aside={tables(r)}
          />
        ))}
        <p className="text-[11px] text-muted">
          Columns are read from the baseline and the checked runs
        </p>
      </div>
    </div>
  );
}

function RowTolerance({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit(n: number): void;
  label: string;
}) {
  const text = String(value);
  const [draft, setDraft] = useState(text);
  const [prev, setPrev] = useState(text);
  const errorId = useId();
  if (prev !== text) {
    setPrev(text);
    setDraft(text);
  }
  const error = draft === text ? null : toleranceError(draft);
  return (
    <div className="flex min-w-0 flex-col">
      <TextInput
        value={draft}
        onChange={(v) => {
          setDraft(v);
          const n = toleranceError(v) === null ? parseFinite(v) : null;
          if (n !== null) onCommit(n);
        }}
        mono
        inputMode="decimal"
        aria-label={label}
        invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        className="h-7 w-full text-[12px]"
      />
      {error !== null && (
        <span id={errorId} className="text-[10px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

const DIRECTION_OPTIONS: { value: Direction; label: string; title: string }[] = [
  { value: 'higher', label: '↑', title: 'Higher is better' },
  { value: 'lower', label: '↓', title: 'Lower is better' },
  { value: 'match', label: '=', title: 'Must match' },
];

function ColumnSelect({
  row,
  kind,
  headers,
  onChange,
}: {
  row: WizardRow;
  kind: SourceKind;
  headers: string[];
  onChange(column: string | null): void;
}) {
  const spec = row[kind];
  const missing = spec === null && headers.length > 0;
  const label = displayName(row.label).full;
  return (
    <Select
      mono
      aria-label={`${kind === 'repo' ? 'Repo table' : 'Wandb'} column for ${label}`}
      value={spec?.column ?? NONE}
      onChange={(v) => onChange(v === NONE ? null : v)}
      className={`h-7 w-full text-[12px] ${missing ? 'border-warn! text-faint' : ''}`}
      options={[
        { value: NONE, label: kind === 'repo' ? 'not in baseline' : 'not in runs' },
        ...headers.map((h) => ({ value: h, label: displayName(h).text })),
      ]}
    />
  );
}

/** Step 2: the metrics table (reference/07) plus the per-LM toggle and the unmatched columns. */
function MetricsStep({
  sources,
  state,
  setState,
}: {
  sources: GenerateSources;
  state: WizardState;
  setState(s: WizardState): void;
}) {
  const repoHeaders = useMemo(() => headersOf(sources, 'repo'), [sources]);
  const wandbHeaders = useMemo(() => headersOf(sources, 'wandb'), [sources]);
  const unmatched = useMemo(() => unmatchedFor(sources, state.rows), [sources, state.rows]);
  const variants = variantColumns(state.rows);
  const prefix = variants[0]?.split('/')[0] ?? 'LM_n';
  const setRow = (i: number, row: WizardRow) =>
    setState({ ...state, rows: state.rows.map((r, j) => (j === i ? row : r)) });
  const groupsWithVariants = state.plan.filter((p) => p.include);
  const extra = unmatched.repo.length + unmatched.wandb.length;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[784px] border-separate border-spacing-0 text-[13px]">
          <colgroup>
            <col className="w-[28px]" />
            <col className="w-[160px]" />
            <col className="w-[230px]" />
            <col className="w-[230px]" />
            <col className="w-[72px]" />
            <col className="w-[64px]" />
          </colgroup>
          <thead>
            <tr className="bg-row-alt text-left text-[11px] font-semibold tracking-wide text-muted uppercase">
              <th className="rounded-l-md px-1 py-2">
                <span className="sr-only">Include</span>
              </th>
              <th className="px-2 py-2">Metric</th>
              <th className="px-2 py-2">Repo table column</th>
              <th className="px-2 py-2">Wandb column</th>
              <th className="px-2 py-2">Direction</th>
              <th className="rounded-r-md px-2 py-2">Tolerance</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row, i) => {
              const label = displayName(row.label).full;
              return (
                <tr
                  key={`${row.key}-${i}`}
                  className={`focus-within:bg-accent-bg ${row.include ? '' : 'text-muted'}`}
                >
                  <td className="rounded-l-md px-1 py-1.5">
                    <input
                      type="checkbox"
                      checked={row.include}
                      aria-label={`Include ${label}`}
                      onChange={(e) => setRow(i, { ...row, include: e.currentTarget.checked })}
                      className={`h-3.5 w-3.5 accent-accent ${FOCUS_RING}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <DisplayName value={row.label} className="font-medium" />
                      {row.units !== undefined && (
                        <DisplayName
                          value={row.units}
                          className="shrink-0 font-mono text-[11px] text-faint"
                        />
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <ColumnSelect
                      row={row}
                      kind="repo"
                      headers={repoHeaders}
                      onChange={(c) => setRow(i, withRowColumn(row, 'repo', c))}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <ColumnSelect
                      row={row}
                      kind="wandb"
                      headers={wandbHeaders}
                      onChange={(c) => setRow(i, withRowColumn(row, 'wandb', c))}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <SegmentedControl<Direction>
                      dense
                      ariaLabel={`Direction of ${label}`}
                      value={row.direction}
                      onChange={(d) => setRow(i, { ...row, direction: d })}
                      options={DIRECTION_OPTIONS}
                    />
                  </td>
                  <td className="rounded-r-md px-2 py-1.5">
                    <RowTolerance
                      label={`Tolerance of ${label}`}
                      value={row.tolerance}
                      onCommit={(n) => setRow(i, { ...row, tolerance: n })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {state.rows.length === 0 && (
        <p className="text-[12px] text-faint">No metric columns were found in the loaded files</p>
      )}
      {variants.length > 0 && sources.baseline.kind === 'repo' && (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-row-alt px-3 py-2.5">
          <Toggle
            checked={state.variantsOn}
            onChange={(on) => setState({ ...state, variantsOn: on })}
            label={
              <span className="flex flex-col">
                <span>
                  {variants.length} <span className="font-mono">{displayName(prefix).text}/…</span>{' '}
                  {variants.length === 1 ? 'column looks' : 'columns look'} like per-LM variants of
                  matched metrics.
                </span>
                <span className="text-[12px] text-muted">
                  Add them as group overrides for{' '}
                  {state.variantTables.length === 0
                    ? 'the groups you pick'
                    : groupsWithVariants
                        .filter((p) => state.variantTables.includes(p.table))
                        .map((p) => displayName(p.name).text)
                        .join(', ') || 'the groups you pick'}
                </span>
              </span>
            }
          />
          {state.variantsOn && (
            <div
              className="flex flex-wrap gap-x-4 gap-y-1"
              role="group"
              aria-label="Groups that get the per-LM overrides"
            >
              {groupsWithVariants.map((p) => (
                <Checkbox
                  key={p.table}
                  checked={state.variantTables.includes(p.table)}
                  onChange={(on) =>
                    setState({
                      ...state,
                      variantTables: on
                        ? [...state.variantTables, p.table]
                        : state.variantTables.filter((t) => t !== p.table),
                    })
                  }
                  label={<DisplayName value={p.name} className="font-mono text-[12px]" />}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {extra > 0 && (
        <details className="min-w-0 rounded-lg border border-border px-3 py-2">
          <summary className={`cursor-pointer text-[12px] text-muted ${FOCUS_RING}`}>
            {plural(extra, 'unmatched column', 'unmatched columns')} · add one as a metric
          </summary>
          <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
            {(['repo', 'wandb'] as const).map((kind) => (
              <ul
                key={kind}
                className="flex min-w-0 flex-col gap-1"
                aria-label={`Unmatched ${kind} columns`}
              >
                {unmatched[kind].slice(0, 200).map((c) => (
                  <li key={c} className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-[10px] text-faint uppercase">{kind}</span>
                    <DisplayName value={c} className="flex-1 font-mono text-[12px]" />
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Add ${displayName(c).full} as a metric`}
                      onClick={() =>
                        setState({
                          ...state,
                          rows: [...state.rows, rowForColumn(kind, c, state.rows)],
                        })
                      }
                    >
                      + add
                    </Button>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Step 3: one row per baseline table (name, counts, include) and the wandb-only choice. */
function GroupsStep({
  sources,
  state,
  setState,
}: {
  sources: GenerateSources;
  state: WizardState;
  setState(s: WizardState): void;
}) {
  const summaries = useMemo(() => tableSummaries(sources), [sources]);
  const errors = planNameErrors(state.plan);
  const wandbOnly = useMemo(() => wandbOnlyCount(sources, state), [sources, state]);
  const errorBase = useId();
  const setPlan = (i: number, patch: Partial<WizardState['plan'][number]>) =>
    setState({ ...state, plan: state.plan.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  if (sources.baseline.kind !== 'repo') {
    const n = buildConfig(sources, state).groups[0]?.experiments.length ?? 0;
    return (
      <p className="text-[13px] text-muted">
        The baseline is a wandb export: the config gets one group{' '}
        <span className="font-mono">wandb</span> with its {plural(n, 'experiment', 'experiments')}.
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr className="bg-row-alt text-left text-[11px] font-semibold tracking-wide text-muted uppercase">
              <th className="w-[44px] rounded-l-md px-2 py-2">Use</th>
              <th className="px-2 py-2">Group name</th>
              <th className="px-2 py-2">Baseline table</th>
              <th className="px-2 py-2 text-right">Experiments</th>
              <th className="rounded-r-md px-2 py-2 text-right">In runs</th>
            </tr>
          </thead>
          <tbody>
            {state.plan.map((p, i) => {
              const s = summaries.find((x) => x.table === p.table);
              const err = errors[i];
              const errId = `${errorBase}-${i}`;
              return (
                <tr
                  key={p.table}
                  className={`focus-within:bg-accent-bg ${p.include ? '' : 'text-muted'}`}
                >
                  <td className="rounded-l-md px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={p.include}
                      aria-label={`Create the group for ${displayName(p.table).full}`}
                      onChange={(e) => setPlan(i, { include: e.currentTarget.checked })}
                      className={`h-3.5 w-3.5 accent-accent ${FOCUS_RING}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <TextInput
                      value={p.name}
                      onChange={(v) => setPlan(i, { name: v })}
                      mono
                      disabled={!p.include}
                      aria-label={`Group name for ${displayName(p.table).full}`}
                      invalid={err !== null}
                      aria-describedby={err !== null ? errId : undefined}
                      className="h-7 w-full text-[12px]"
                    />
                    {err !== null && (
                      <span id={errId} className="text-[11px] text-danger">
                        {err}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <DisplayName
                      value={p.table}
                      className="block font-mono text-[12px] text-muted"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {s?.experiments ?? 0}
                  </td>
                  <td className="rounded-r-md px-2 py-1.5 text-right font-mono tabular-nums">
                    {s?.matchedInRuns ?? 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-border bg-row-alt px-3 py-2.5">
        <p className="min-w-0 flex-1 text-[13px]">
          <span className="font-medium">Wandb-only experiments</span>{' '}
          <span className="text-muted">
            · {plural(wandbOnly, 'run experiment is', 'run experiments are')} in no baseline table
          </span>
        </p>
        <SegmentedControl<'group' | 'unassigned'>
          dense
          ariaLabel="Wandb-only experiments"
          value={state.wandbOnly}
          onChange={(v) => setState({ ...state, wandbOnly: v })}
          options={[
            { value: 'group', label: 'Add as group', disabled: wandbOnly === 0 },
            { value: 'unassigned', label: 'Leave unassigned' },
          ]}
        />
      </div>
    </div>
  );
}

/** The wizard modal; `step` is `ui.modal.step`. */
export function GenerateWizard({ step }: { step: Step }) {
  const baseline = useAppStore((s) => s.sources.baseline);
  const runs = useAppStore((s) => s.sources.runs);
  const closeModal = useAppStore((s) => s.closeModal);
  const openModal = useAppStore((s) => s.openModal);
  const [runIds, setRunIds] = useState<string[] | null>(null);
  const selectedIds = runIds ?? runs.map((r) => r.id);
  const selectedRuns = useMemo(
    () => (runIds === null ? runs : runs.filter((r) => runIds.includes(r.id))),
    [runs, runIds],
  );
  const sources = useMemo<GenerateSources | null>(
    () => (baseline ? { baseline, runs: selectedRuns } : null),
    [baseline, selectedRuns],
  );
  const sourcesKey = baseline ? [baseline.id, ...selectedRuns.map((r) => r.id)].join('\u0000') : '';
  const initial = useMemo(() => (sources ? initialWizardState(sources) : null), [sources]);
  const [edited, setEdited] = useState<{ key: string; state: WizardState } | null>(null);
  const state = edited !== null && edited.key === sourcesKey ? edited.state : initial;
  const setState = (s: WizardState) => setEdited({ key: sourcesKey, state: s });
  const go = (n: Step) => openModal({ kind: 'generate', step: n });

  const effectiveStep: Step = sources === null ? 1 : step;
  const included = state?.rows.filter((r) => r.include).length ?? 0;
  const nameErrors = state ? planNameErrors(state.plan) : [];
  const preview = useMemo(
    () => (sources && state && effectiveStep === 3 ? buildConfig(sources, state) : null),
    [sources, state, effectiveStep],
  );

  const create = () => {
    if (!sources || !state || nameErrors.some((e) => e !== null)) return;
    const config = buildConfig(sources, state);
    const store = useAppStore.getState();
    store.createConfig(config);
    store.closeModal();
    store.setView('config');
    const metrics = Object.keys(config.metrics).length;
    store.pushToast(
      'info',
      `Created config ${displayName(config.name).text} · ${plural(config.groups.length, 'group', 'groups')} · ${plural(metrics, 'metric', 'metrics')}`,
    );
  };

  let body: ReactNode;
  let footer: ReactNode;
  if (sources === null || state === null) {
    body = (
      <p className="text-[13px] text-muted">
        Load a baseline first (and the runs to compare): the wizard reads the column names and
        experiments of the loaded files.
      </p>
    );
    footer = <Button onClick={closeModal}>Close</Button>;
  } else if (effectiveStep === 1) {
    body = (
      <SourcesStep
        baseline={sources.baseline}
        runs={runs}
        selected={selectedIds}
        onToggle={(id, on) =>
          setRunIds(on ? [...selectedIds, id] : selectedIds.filter((x) => x !== id))
        }
      />
    );
    footer = (
      <>
        <Button onClick={closeModal}>Cancel</Button>
        <Button variant="primary" onClick={() => go(2)}>
          Next: metrics →
        </Button>
      </>
    );
  } else if (effectiveStep === 2) {
    body = <MetricsStep sources={sources} state={state} setState={setState} />;
    footer = (
      <>
        <p className="mr-auto self-center text-[12px] text-muted">
          {included} of {plural(state.rows.length, 'metric', 'metrics')} · everything stays editable
          in the Config view
        </p>
        <Button onClick={() => go(1)}>Back</Button>
        <Button variant="primary" onClick={() => go(3)}>
          Next: groups →
        </Button>
      </>
    );
  } else {
    body = <GroupsStep sources={sources} state={state} setState={setState} />;
    const experiments = preview?.groups.reduce((n, g) => n + g.experiments.length, 0) ?? 0;
    footer = (
      <>
        <p className="mr-auto self-center text-[12px] text-muted">
          {plural(preview?.groups.length ?? 0, 'group', 'groups')} ·{' '}
          {plural(experiments, 'experiment', 'experiments')} ·{' '}
          {plural(included, 'metric', 'metrics')}
        </p>
        <Button onClick={() => go(2)}>Back</Button>
        <Button variant="primary" disabled={nameErrors.some((e) => e !== null)} onClick={create}>
          Create config
        </Button>
      </>
    );
  }

  return (
    <Modal title="Generate config from files" onClose={closeModal} width={920} footer={footer}>
      <div className="flex min-w-0 flex-col gap-4">
        <p className="-mt-1 text-[12px] text-muted">
          Columns are matched by name and units; check the guesses, then pick groups.
        </p>
        {sources !== null && (
          <Stepper
            step={effectiveStep}
            from={sources.baseline.label}
            to={sources.runs.map((r) => r.label)}
          />
        )}
        {body}
      </div>
    </Modal>
  );
}
