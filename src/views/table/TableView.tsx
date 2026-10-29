import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { runBg } from '../../components/runColor';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { CopyFallback } from '../../components/ui/CopyFallback';
import { DropMenu, type DropMenuItem } from '../../components/ui/DropMenu';
import { SearchInput } from '../../components/ui/SearchInput';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { VERDICT_LABEL } from '../../components/ui/verdict';
import { renderMarkdown } from '../../compare/markdown';
import type { Comparison, Config, ExperimentRow, Metric, Source } from '../../model/types';
import { registerTableExpandAll } from '../../state/keyboard';
import { experimentKey, useComparison, useExperimentCount } from '../../state/selectors';
import { useAppStore } from '../../state/store';
import { copyText } from '../../util/clipboard';
import { localDateStamp } from '../../util/dates';
import { DisplayName } from '../../util/DisplayName';
import { downloadBlob, MIME, safeFileName } from '../../util/download';
import { useMediaQuery } from '../../util/useMediaQuery';
import { chartForExperiment } from '../charts/chartActions';
import { directionText, formatDelta, formatValue } from '../overview/model';
import {
  experimentCount,
  markdownComparison,
  runSummary,
  tableModel,
  visibleRuns,
  type MarkdownScope,
  type TableChip,
  type TableGroupView,
  type TableSort,
} from './filters';

/*
 * Table view (spec Phase 5a, reference/02-table.png): group header rows, collapsed experiment rows
 * with per-run summary chips, expanded rows with one line per visible metric (baseline, per-run
 * value + Δ chip). Every file-derived string renders through <DisplayName>/displayName(); the
 * Markdown copy/download passes renderMarkdown's (already escaped) output on unchanged.
 */

const SORT_LABEL: Record<TableSort, string> = {
  config: 'config order',
  name: 'name',
  regressions: 'most regressions',
};

const CHIP_LABEL: Record<TableChip, string> = {
  all: 'All',
  regressions: 'Regressions',
  improvements: 'Improvements',
  missing: 'Missing',
};

/**
 * Experiment/metric column, baseline column, one column per visible run. Below 900 px (`compact`)
 * the per-run columns collapse into stacked lines inside each row (spec Phase 7 "Responsive").
 */
function gridStyle(runs: number, compact: boolean): CSSProperties {
  return {
    gridTemplateColumns: compact
      ? 'minmax(0, 1fr) 96px'
      : `minmax(360px, 2.2fr) 104px repeat(${runs}, minmax(200px, 1fr))`,
  };
}
const minWidth = (runs: number, compact: boolean) =>
  compact ? undefined : 360 + 104 + runs * 200 + 32;

function RunDot({ run, allRuns }: { run: Source; allRuns: Source[] }) {
  return (
    <span
      aria-hidden="true"
      className={`h-2 w-2 shrink-0 rounded-full ${runBg(allRuns.indexOf(run))}`}
    />
  );
}

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

/** Baseline value of a metric: the same in every run's cell, so take the first one present. */
function baseValue(row: ExperimentRow, key: string): number | null {
  for (const cells of Object.values(row.cells)) {
    const c = cells[key];
    if (c) return c.base;
  }
  return null;
}

function DeltaChip({
  row,
  runId,
  k,
  metric,
}: {
  row: ExperimentRow;
  runId: string;
  k: string;
  metric: Metric;
}) {
  const cell = row.cells[runId]?.[k];
  if (!cell) return null;
  // A `match` metric within tolerance shows just "=", a missing cell just "—" (the glyph).
  const text =
    cell.verdict === 'missing' || (metric.direction === 'match' && cell.verdict === 'same')
      ? ''
      : formatDelta(cell.delta, metric);
  return (
    <Chip variant="diff" verdict={cell.verdict} title={`Δ ${VERDICT_LABEL[cell.verdict]}`}>
      {text}
    </Chip>
  );
}

function RunSummaryChips({
  row,
  run,
  metrics,
}: {
  row: ExperimentRow;
  run: Source;
  metrics: string[];
}) {
  const s = runSummary(row, run.id, metrics);
  if (s.notInRun) {
    return <span className="text-[11px] text-faint">not in run</span>;
  }
  const { counts } = s;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {counts.better > 0 && (
        <Chip variant="verdict" verdict="better" title={`${counts.better} better`}>
          {counts.better}
        </Chip>
      )}
      {counts.worse > 0 && (
        <Chip variant="verdict" verdict="worse" title={`${counts.worse} worse`}>
          {counts.worse}
        </Chip>
      )}
      {s.episodes && (
        <Chip
          variant="count"
          glyph="!"
          tone="warn"
          title="A must-match metric (e.g. the number of episodes) differs from the baseline"
        >
          episodes
        </Chip>
      )}
      {counts.missing > 0 && (
        <Chip variant="count" glyph="—" title={`${counts.missing} metrics have no value`}>
          {counts.missing} missing
        </Chip>
      )}
      {counts.same > 0 && (
        <span className="text-[11px] whitespace-nowrap text-faint">{counts.same} same</span>
      )}
      {s.rows > 1 && (
        <Chip
          variant="count"
          glyph="⧉"
          tone="warn"
          title={`${s.rows} rows of this run match; the chosen one is used (pick another in the Config view)`}
        >
          {s.rows} rows
        </Chip>
      )}
    </span>
  );
}

interface RowProps {
  row: ExperimentRow;
  metrics: string[];
  config: Config;
  runs: Source[];
  allRuns: Source[];
  expanded: boolean;
  compact: boolean;
  style: CSSProperties;
  onToggle(key: string): void;
  onChart(group: string, experiment: string): void;
}

const ExperimentRowView = memo(function ExperimentRowView({
  row,
  metrics,
  config,
  runs,
  allRuns,
  expanded,
  compact,
  style,
  onToggle,
  onChart,
}: RowProps) {
  const key = experimentKey(row.group, row.name);
  const noBase = row.baseRow.how === 'none';
  const baseDup = row.baseRow.candidates.length;
  const nameCell = (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => onToggle(key)}
      className="flex h-full min-w-0 items-center gap-2 pr-3 pl-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      <span aria-hidden="true" className="w-3 shrink-0 text-[10px] text-faint">
        {expanded ? '▾' : '▸'}
      </span>
      <DisplayName
        value={row.name}
        className={`flex-1 font-mono text-[12px] ${expanded ? 'font-medium text-accent' : 'text-text'}`}
      />
      <span className="shrink-0 text-[11px] text-faint max-[480px]:hidden">
        {metrics.length} {metrics.length === 1 ? 'metric' : 'metrics'}
      </span>
    </button>
  );
  const baseCell = (
    <div className="flex items-center justify-end gap-1 px-2">
      {noBase && <span className="text-[11px] whitespace-nowrap text-warn">not in baseline</span>}
      {baseDup > 1 && (
        <Chip
          variant="count"
          glyph="⧉"
          tone="warn"
          title={`${baseDup} baseline rows match; the chosen one is used (pick another in the Config view)`}
        >
          {baseDup} rows
        </Chip>
      )}
    </div>
  );

  if (!expanded) {
    return (
      <div
        data-row-key={key}

        className="grid min-h-[30px] items-center border-b border-border hover:bg-row-alt"
        style={style}
      >
        {nameCell}
        {baseCell}
        {compact ? (
          <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pr-3 pb-1.5 pl-9">
            {runs.map((run) => (
              <span key={run.id} className="flex min-w-0 items-center gap-1.5">
                <RunDot run={run} allRuns={allRuns} />
                <span className="sr-only">
                  <DisplayName value={run.label} />:{' '}
                </span>
                <RunSummaryChips row={row} run={run} metrics={metrics} />
              </span>
            ))}
          </div>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="flex min-w-0 items-center px-3 py-1">
              <RunSummaryChips row={row} run={run} metrics={metrics} />
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div
      data-row-key={key}

      className="border-b border-l-2 border-border border-l-accent bg-row-alt"
    >
      <div className="grid min-h-[30px] items-center" style={style}>
        {nameCell}
        {baseCell}
        <div
          className={`flex justify-end px-3 ${compact ? 'pb-1' : ''}`}
          style={{ gridColumn: compact ? '1 / span 2' : `3 / span ${runs.length}` }}
        >
          <button
            type="button"
            onClick={() => onChart(row.group, row.name)}
            className="rounded text-[12px] font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Chart this experiment →
          </button>
        </div>
      </div>
      {metrics.length === 0 && (
        <p className="py-2 pl-10 text-[12px] text-muted">Every metric of this group is hidden.</p>
      )}
      {metrics.map((k) => {
        const metric = config.metrics[k];
        return (
          <div key={k} className="grid min-h-[30px] items-center" style={style}>
            <div
              className={`grid min-w-0 items-center gap-2 pr-3 pl-9 text-[12px] ${compact ? 'grid-cols-[minmax(0,1fr)_minmax(0,56px)]' : 'grid-cols-[minmax(0,150px)_56px_minmax(0,1fr)]'}`}
            >
              <DisplayName value={metric.label || k} className="text-text" />
              {metric.units ? (
                <DisplayName value={metric.units} className="text-faint" />
              ) : (
                <span />
              )}
              {!compact && <span className="truncate text-faint">{directionText(metric)}</span>}
            </div>
            <div className="px-2 text-right font-mono text-[12px] text-text">
              {formatValue(baseValue(row, k), metric)}
            </div>
            {runs.map((run) => {
              const cell = row.cells[run.id]?.[k];
              return (
                <div
                  key={run.id}
                  className={`flex min-w-0 items-center gap-2 ${compact ? 'col-span-2 pr-3 pb-1 pl-12' : 'px-3'}`}
                >
                  {compact && (
                    <>
                      <RunDot run={run} allRuns={allRuns} />
                      <DisplayName
                        value={run.label}
                        className="min-w-0 flex-1 font-mono text-[11px] text-muted"
                      />
                    </>
                  )}
                  <span className="w-[72px] shrink-0 text-right font-mono text-[12px] text-text">
                    {cell ? formatValue(cell.value, metric) : '—'}
                  </span>
                  <DeltaChip row={row} runId={run.id} k={k} metric={metric} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
});

function GroupBlock({
  view,
  config,
  runs,
  allRuns,
  compact,
  style,
  expanded,
  collapsed,
  onToggleGroup,
  onToggleRow,
  onChart,
}: {
  view: TableGroupView;
  config: Config;
  runs: Source[];
  allRuns: Source[];
  compact: boolean;
  style: CSSProperties;
  expanded: ReadonlySet<string>;
  collapsed: boolean;
  onToggleGroup(name: string): void;
  onToggleRow(key: string): void;
  onChart(group: string, experiment: string): void;
}) {
  const { group, rows, total } = view;
  const count = rows.length === total ? `${total}` : `${rows.length} of ${total}`;
  return (
    <div>
      <div className="flex min-h-[34px] items-center border-b border-border bg-panel">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => onToggleGroup(group.name)}
          className="flex min-w-0 items-center gap-2 px-4 py-1.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true" className="w-3 shrink-0 text-[10px] text-faint">
            {collapsed ? '▸' : '▾'}
          </span>
          <DisplayName
            value={group.name}
            className="font-mono text-[12px] font-semibold text-text"
          />
          <span className="flex min-w-0 gap-1 font-mono text-[11px] text-faint">
            {group.table === null ? (
              <span>no repo table</span>
            ) : (
              <DisplayName value={group.table} />
            )}
            <span className="shrink-0">
              · {count} {total === 1 ? 'experiment' : 'experiments'}
            </span>
          </span>
          {!view.valid && (
            <span className="shrink-0 rounded border border-warn px-1 text-[10px] text-warn">
              table missing
            </span>
          )}
        </button>
      </div>
      {!collapsed &&
        rows.map(({ row }) => (
          <ExperimentRowView
            key={row.name}
            row={row}
            metrics={view.metrics}
            config={config}
            runs={runs}
            allRuns={allRuns}
            compact={compact}
            expanded={expanded.has(experimentKey(row.group, row.name))}
            style={style}
            onToggle={onToggleRow}
            onChart={onChart}
          />
        ))}
      {!collapsed && rows.length === 0 && (
        <p className="border-b border-border py-2 pl-10 text-[12px] text-muted">
          {total === 0 ? 'This group has no experiments.' : 'No experiment of this group matches.'}
        </p>
      )}
    </div>
  );
}

/** Table: header, toolbar (filter, chips, sort), grouped experiment rows; Markdown copy/download. */
export function TableView() {
  const cmp = useComparison();
  const config = useAppStore((s) => s.config.active.config);
  const baseline = useAppStore((s) => s.sources.baseline);
  const allRuns = useAppStore((s) => s.sources.runs);
  const table = useAppStore((s) => s.session.table);
  const hiddenGroups = useAppStore((s) => s.session.overview.groups);
  const setSession = useAppStore((s) => s.setSession);
  const setView = useAppStore((s) => s.setView);
  const pushToast = useAppStore((s) => s.pushToast);
  const experiments = useExperimentCount();
  const runs = useMemo(() => visibleRuns(allRuns), [allRuns]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [fallback, setFallback] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const compact = !useMediaQuery('(min-width: 900px)');

  const model = useMemo(
    () =>
      cmp
        ? tableModel(cmp, config, runs, {
            filter: table.filter,
            chip: table.chip,
            sort: table.sort,
            hiddenGroups,
            hiddenMetrics: table.metrics,
          })
        : null,
    [cmp, config, runs, table.filter, table.chip, table.sort, table.metrics, hiddenGroups],
  );

  const shownKeys = useMemo(
    () =>
      model
        ? model.groups.flatMap((g) => g.rows.map(({ row }) => experimentKey(row.group, row.name)))
        : [],
    [model],
  );
  // `e` (src/state/keyboard.ts) runs the same toggle as the "Expand all" button below.
  useEffect(() => {
    if (shownKeys.length === 0) return;
    registerTableExpandAll(() => {
      const expanded = useAppStore.getState().session.table.expanded;
      const all = shownKeys.every((k) => expanded.has(k));
      setSession({ table: { expanded: all ? new Set() : new Set([...expanded, ...shownKeys]) } });
    });
    return () => registerTableExpandAll(null);
  }, [shownKeys, setSession]);

  // Opened from the Overview: bring the most recently expanded experiment into view once.
  useEffect(() => {
    const keys = [...useAppStore.getState().session.table.expanded];
    const last = keys[keys.length - 1];
    if (last === undefined) return;
    const el = Array.from(
      scroller.current?.querySelectorAll<HTMLElement>('[data-row-key]') ?? [],
    ).find((e) => e.dataset.rowKey === last);
    el?.scrollIntoView?.({ block: 'center' });
  }, []);

  const toggleRow = useCallback(
    (key: string) => {
      const expanded = new Set(useAppStore.getState().session.table.expanded);
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      setSession({ table: { expanded } });
    },
    [setSession],
  );
  const toggleGroup = useCallback(
    (name: string) =>
      setCollapsedGroups((c) => {
        const next = new Set(c);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      }),
    [],
  );
  // "Chart this experiment →": select (or create) a grouped-bars chart of just this experiment.
  const chart = useCallback(
    (group: string, experiment: string) => {
      const s = useAppStore.getState();
      const res = chartForExperiment(s.config.active.config, group, experiment);
      if (!res) {
        pushToast('warn', 'No chart could be created for this experiment (chart limit reached?).');
        return;
      }
      if (res.config !== s.config.active.config) s.updateConfig(() => res.config);
      s.setSession({ charts: { selected: res.id } });
      setView('charts');
    },
    [pushToast, setView],
  );

  if (!cmp || !model || !baseline) return null;

  const style = gridStyle(runs.length, compact);
  const allExpanded = shownKeys.length > 0 && shownKeys.every((k) => table.expanded.has(k));

  const expandAll = () => {
    if (allExpanded) setSession({ table: { expanded: new Set() } });
    else setSession({ table: { expanded: new Set([...table.expanded, ...shownKeys]) } });
  };

  const scoped = (scope: MarkdownScope): Comparison =>
    markdownComparison(cmp, config, model, table.metrics, scope);
  const markdownOf = (c: Comparison): string =>
    renderMarkdown(c, config, {
      baselineLabel: baseline.label,
      runLabels: runs.map((r) => r.label),
      runIds: runs.map((r) => r.id),
    });

  const copy = async (scope: MarkdownScope) => {
    const c = scoped(scope);
    const n = experimentCount(c);
    const text = markdownOf(c);
    setFallback(null);
    if (await copyText(text)) {
      pushToast('info', `Copied ${n} ${n === 1 ? 'experiment' : 'experiments'} as Markdown`);
    } else {
      setFallback(text);
    }
  };
  const download = () => {
    const text = markdownOf(scoped({ kind: 'visible' }));
    downloadBlob(
      safeFileName(`benchmarks-${config.name}-${localDateStamp()}.md`),
      new Blob([text], { type: MIME.markdown }),
    );
  };

  const allCount = experimentCount(scoped({ kind: 'all' }));
  const nothing = runs.length === 0;
  const menu: DropMenuItem[] = [
    {
      key: 'all',
      label: 'All experiments',
      description: `${allCount} experiments · visible metrics and runs`,
      disabled: allCount === 0 || nothing,
      onSelect: () => void copy({ kind: 'all' }),
    },
    {
      key: 'visible',
      label: 'Visible rows',
      description: `${model.shown} rows as filtered and sorted`,
      disabled: model.shown === 0 || nothing,
      onSelect: () => void copy({ kind: 'visible' }),
    },
    ...cmp.groups.map((g, i) => ({
      key: `group\u0000${i}`,
      label: (
        <span className="flex min-w-0 gap-1">
          This group: <DisplayName value={g.group.name} className="font-mono" />
        </span>
      ),
      description: `${g.experiments.length} experiments`,
      disabled: g.experiments.length === 0 || nothing,
      onSelect: () => void copy({ kind: 'group', name: g.group.name }),
    })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 mid:p-6">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[17px] font-semibold text-text">
          Table
          <span className="flex min-w-0 gap-1 font-mono text-[12px] font-normal text-muted">
            {experiments} experiments · {runs.length} {runs.length === 1 ? 'run' : 'runs'} vs{' '}
            <DisplayName value={baseline.label} />
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={expandAll} disabled={shownKeys.length === 0}>
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </Button>
          <DropMenu
            align="right"
            ariaLabel="Copy as Markdown"
            label={
              <>
                <CopyIcon />
                Copy as Markdown
                <span aria-hidden="true" className="text-[10px] text-faint">
                  ▾
                </span>
              </>
            }
            items={menu}
          />
          <Button
            onClick={download}
            disabled={model.shown === 0 || nothing}
            title="Download the visible rows as a Markdown file"
            aria-label="Download the visible rows as .md"
          >
            <DownloadIcon />
            .md
          </Button>
        </div>
      </header>

      {fallback !== null && (
        <CopyFallback text={fallback} label="Markdown report" onClose={() => setFallback(null)} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          shortcut
          value={table.filter}
          onChange={(filter) => setSession({ table: { filter } })}
          placeholder="Filter experiments…"
          className="w-full mid:w-[260px]"
        />
        <SegmentedControl
          ariaLabel="Show rows"
          dense
          scroll={compact}
          value={table.chip}
          onChange={(chip) => setSession({ table: { chip } })}
          options={(['all', 'regressions', 'improvements', 'missing'] as const).map((c) => ({
            value: c,
            label: (
              <span className="flex items-center gap-1.5">
                {CHIP_LABEL[c]}
                <span
                  className={`font-mono text-[11px] ${c === 'regressions' ? 'text-worse' : 'text-faint'}`}
                >
                  {model.counts[c]}
                </span>
              </span>
            ),
          }))}
        />
        <div className="ml-auto">
          <DropMenu
            align="right"
            variant="ghost"
            ariaLabel={`Sort: ${SORT_LABEL[table.sort]}`}
            label={
              <span className="text-muted">
                Sort: {SORT_LABEL[table.sort]}{' '}
                <span aria-hidden="true" className="text-[10px]">
                  ▾
                </span>
              </span>
            }
            items={(['config', 'name', 'regressions'] as const).map((sort) => ({
              key: sort,
              label: `${sort === table.sort ? '✓ ' : ''}${SORT_LABEL[sort]}`,
              onSelect: () => setSession({ table: { sort } }),
            }))}
          />
        </div>
      </div>

      {nothing ? (
        <p className="text-[13px] text-muted">
          Every run is hidden. Use the eye toggles in the sidebar.
        </p>
      ) : (
        <div
          ref={scroller}
          className="max-h-[calc(100vh-230px)] min-h-[320px] overflow-auto rounded-lg border border-border bg-panel"
        >
          <div style={{ minWidth: minWidth(runs.length, compact) }}>
            <div
              className="sticky top-0 z-10 grid h-[44px] items-center border-b border-border bg-panel text-[11px] font-semibold tracking-wide text-muted uppercase"
              style={style}
            >
              <span className="px-4">Experiment / metric</span>
              <span className="px-2 text-right">Baseline</span>
              {!compact &&
                runs.map((run) => (
                  <span
                    key={run.id}
                    className="flex min-w-0 items-center gap-1.5 px-3 normal-case tracking-normal"
                  >
                    <RunDot run={run} allRuns={allRuns} />
                    <DisplayName value={run.label} className="font-mono text-[12px] text-text" />
                  </span>
                ))}
            </div>
            {model.groups.map((g) => (
              <GroupBlock
                key={g.group.name}
                view={g}
                config={config}
                runs={runs}
                allRuns={allRuns}
                compact={compact}
                style={style}
                expanded={table.expanded}
                collapsed={collapsedGroups.has(g.group.name)}
                onToggleGroup={toggleGroup}
                onToggleRow={toggleRow}
                onChart={chart}
              />
            ))}
            {model.shown === 0 && (
              <p className="px-4 py-6 text-[13px] text-muted">
                {model.groups.length === 0 && cmp.groups.length > 0 && hiddenGroups.size > 0
                  ? 'Every benchmark group is unchecked in the sidebar.'
                  : 'No experiment matches the current filters.'}
              </p>
            )}
          </div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {model.shown} rows shown
      </span>
    </div>
  );
}
