import { memo, useCallback, useState } from 'react';
import { runBg } from '../../components/runColor';
import { VERDICT_GLYPH } from '../../components/ui/verdict';
import type { Bounds } from '../../components/ui/tooltipPlacement';
import type { Cell, Config, ExperimentRow, Metric, Source } from '../../model/types';
import { experimentKey } from '../../state/selectors';
import { useAppStore } from '../../state/store';
import { displayName } from '../../util/displayName';
import { DisplayName } from '../../util/DisplayName';
import { CellTooltip, type TooltipTarget } from './CellTooltip';
import { heatStep } from './heat';
import { formatDelta, formatValue, type OverviewModel } from './model';

/*
 * Geometry (spec Phase 3 "Heatmap geometry"): 18 px cells with a 4 px gap, a run block is
 * `metrics × 22 + 16` px wide and blocks are 24 px apart; rows 23 px, group headers 28 px, header
 * 110 px; the experiment column is 320 px and sticky. Every configured experiment is rendered.
 */
// Narrower below 900 px so a few run columns stay visible next to the names (Phase 7).
const NAME_COL = 'w-[200px] min-w-[200px] mid:w-[320px] mid:min-w-[320px]';
const blockWidth = (metrics: number) => metrics * 22 + 16;

const FILL = {
  better: ['bg-heat-same', 'bg-heat-better-1', 'bg-heat-better-2', 'bg-heat-better-3'],
  worse: ['bg-heat-same', 'bg-heat-worse-1', 'bg-heat-worse-2', 'bg-heat-worse-3'],
} as const;

function cellClass(cell: Cell, step: number): string {
  switch (cell.verdict) {
    case 'missing':
      return 'border border-dashed border-faint bg-transparent text-faint';
    case 'same':
      return 'bg-heat-same text-faint';
    case 'better':
      return `${FILL.better[step]} ${step === 3 ? 'text-panel' : 'text-better'}`;
    default:
      return `${FILL.worse[step]} ${step === 3 ? 'text-panel' : 'text-worse'}`;
  }
}

function mainBounds(): Bounds | undefined {
  const r = document.getElementById('main-view')?.getBoundingClientRect();
  return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : undefined;
}

interface RowProps {
  row: ExperimentRow;
  metrics: string[];
  groupMetrics: ReadonlySet<string>;
  runs: Source[];
  config: Config;
  mode: 'tolerance' | 'percent';
  onHover(target: TooltipTarget | null): void;
  onOpen(row: ExperimentRow): void;
}

const HeatRow = memo(function HeatRow({
  row,
  metrics,
  groupMetrics,
  runs,
  config,
  mode,
  onHover,
  onOpen,
}: RowProps) {
  const name = displayName(row.name).full;
  return (
    <div className="group/row flex h-[23px] items-center hover:bg-row-alt">
      <div
        className={`${NAME_COL} sticky left-0 z-10 flex h-full items-center bg-panel pr-3 pl-6 group-hover/row:bg-row-alt`}
      >
        <DisplayName value={row.name} className="font-mono text-[12px] text-text" />
      </div>
      {runs.map((run) => {
        const cells = row.cells[run.id] ?? {};
        const episodes = row.episodesMismatch[run.id] === true;
        return (
          <div
            key={run.id}
            className={`ml-6 flex h-[21px] shrink-0 items-center gap-1 rounded px-2 ${
              episodes ? 'outline-1 outline-warn' : ''
            }`}
            style={{ width: blockWidth(metrics.length) }}
            title={episodes ? 'Number of episodes differs from the baseline' : undefined}
          >
            {metrics.map((k) => {
              const cell = cells[k];
              const metric: Metric | undefined = config.metrics[k];
              if (!cell || !metric || !groupMetrics.has(k)) {
                return <span key={k} aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />;
              }
              const step = heatStep(cell, metric, mode);
              const value = cell.value === null ? '—' : formatValue(cell.value, metric);
              const label = `${name}, ${displayName(metric.label).full}, ${displayName(run.label).full}: ${value}, Δ ${formatDelta(cell.delta, metric)}, ${cell.verdict}`;
              const hover = (el: HTMLElement) => {
                const r = el.getBoundingClientRect();
                onHover({
                  anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
                  row,
                  metricKey: k,
                });
              };
              return (
                <button
                  key={k}
                  type="button"
                  aria-label={label}
                  onMouseEnter={(e) => hover(e.currentTarget)}
                  onFocus={(e) => hover(e.currentTarget)}
                  onMouseLeave={() => onHover(null)}
                  onBlur={() => onHover(null)}
                  onClick={() => onOpen(row)}
                  className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] text-[9px] leading-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-select ${cellClass(cell, step)}`}
                >
                  <span aria-hidden="true">{VERDICT_GLYPH[cell.verdict]}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
});

/** Experiments × (runs × metrics) verdict heatmap with collapsible groups and a cell tooltip. */
export function Heatmap({
  model,
  config,
  runs,
  allRuns,
}: {
  model: OverviewModel;
  config: Config;
  runs: Source[];
  allRuns: Source[];
}) {
  const mode = useAppStore((s) => s.session.overview.cellColor);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [tip, setTip] = useState<TooltipTarget | null>(null);
  const hide = useCallback(() => setTip(null), []);
  const { metrics } = model;

  const onOpen = useCallback((row: ExperimentRow) => {
    const s = useAppStore.getState();
    const expanded = new Set(s.session.table.expanded);
    expanded.add(experimentKey(row.group, row.name));
    s.setSession({ table: { expanded } });
    s.setView('table');
  }, []);

  const toggle = (name: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const width = 320 + runs.length * (blockWidth(metrics.length) + 24) + 24;

  return (
    <div className="relative max-h-[calc(100vh-240px)] min-h-[320px] overflow-auto rounded-lg border border-border bg-panel">
      <div style={{ minWidth: width }}>
        {/* Sticky column header: run colour bars + rotated metric labels. */}
        <div className="sticky top-0 z-20 flex h-[110px] items-end border-b border-border bg-panel pb-2">
          <div
            className={`${NAME_COL} sticky left-0 z-10 self-stretch bg-panel px-4 pb-0 text-[11px] font-semibold tracking-wide text-muted uppercase`}
          >
            <span className="absolute bottom-2">Experiment</span>
          </div>
          {runs.map((run) => (
            <div
              key={run.id}
              className="ml-6 flex h-full shrink-0 flex-col"
              style={{ width: blockWidth(metrics.length) }}
            >
              <span
                aria-hidden="true"
                className={`h-[3px] w-full rounded ${runBg(allRuns.indexOf(run))}`}
              />
              <DisplayName
                value={run.label}
                className="mt-0.5 block font-mono text-[11px] text-text"
              />
              <div className="mt-auto flex gap-1 px-2">
                {metrics.map((k) => (
                  <span
                    key={k}
                    className="flex h-[80px] w-[18px] shrink-0 items-end justify-center overflow-hidden"
                  >
                    <span
                      className="rotate-180 truncate font-mono text-[10px] text-muted [writing-mode:vertical-rl]"
                      title={displayName(config.metrics[k]?.label ?? k).full}
                    >
                      {displayName(config.metrics[k]?.label ?? k, { max: 13 }).text}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {model.groups.map((g) => {
          const isCollapsed = collapsed.has(g.group.name);
          const groupMetrics = new Set(g.group.metrics);
          return (
            <div key={g.group.name} role="rowgroup" className="pb-1">
              <div className="flex h-[28px] items-center">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(g.group.name)}
                  className={`${NAME_COL} sticky left-0 z-10 flex h-full items-center gap-1.5 bg-panel px-4 text-left focus-visible:outline-2 focus-visible:outline-accent`}
                >
                  <span aria-hidden="true" className="w-3 text-[10px] text-faint">
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                  <DisplayName value={g.group.name} className="font-mono text-[12px] text-muted" />
                  <span className="shrink-0 font-mono text-[11px] text-faint">
                    · {g.rows.length === g.total ? g.total : `${g.rows.length} of ${g.total}`}
                  </span>
                  {!g.valid && (
                    <span className="shrink-0 rounded border border-warn px-1 text-[10px] text-warn">
                      table missing
                    </span>
                  )}
                </button>
              </div>
              {!isCollapsed &&
                g.rows.map((row) => (
                  <HeatRow
                    key={row.name}
                    row={row}
                    metrics={metrics}
                    groupMetrics={groupMetrics}
                    runs={runs}
                    config={config}
                    mode={mode}
                    onHover={setTip}
                    onOpen={onOpen}
                  />
                ))}
            </div>
          );
        })}
        {model.groups.every((g) => g.rows.length === 0) && (
          <p className="px-4 py-6 text-[13px] text-muted">
            No experiment matches the current filters.
          </p>
        )}
      </div>
      {tip && config.metrics[tip.metricKey] && (
        <CellTooltip
          target={tip}
          metric={config.metrics[tip.metricKey]}
          runs={runs}
          allRuns={allRuns}
          bounds={mainBounds()}
          onDismiss={hide}
        />
      )}
    </div>
  );
}
