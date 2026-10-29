import { runBg } from '../../components/runColor';
import { Tooltip } from '../../components/ui/Tooltip';
import type { Bounds } from '../../components/ui/tooltipPlacement';
import type { ExperimentRow, Metric, Source } from '../../model/types';
import { DisplayName } from '../../util/DisplayName';
import { directionText, formatDelta, formatValue, toleranceText } from './model';

export interface TooltipTarget {
  anchor: Bounds;
  row: ExperimentRow;
  metricKey: string;
}

const BAR_PX = 80;

/** Hover/focus tooltip of a heatmap cell: baseline and every visible run's value and Δ. */
export function CellTooltip({
  target,
  metric,
  runs,
  allRuns,
  bounds,
  onDismiss,
}: {
  target: TooltipTarget;
  metric: Metric;
  runs: Source[];
  allRuns: Source[];
  bounds?: Bounds;
  onDismiss(): void;
}) {
  const { row, metricKey } = target;
  const firstCell = runs.map((r) => row.cells[r.id]?.[metricKey]).find((c) => c !== undefined);
  const base = firstCell?.base ?? null;
  const values = [base, ...runs.map((r) => row.cells[r.id]?.[metricKey]?.value ?? null)];
  const max = Math.max(...values.map((v) => (v === null ? 0 : Math.abs(v))), 0);
  const width = (v: number | null) => (v === null || max === 0 ? 0 : (Math.abs(v) / max) * BAR_PX);

  return (
    <Tooltip anchor={target.anchor} bounds={bounds} onDismiss={onDismiss} className="w-[300px]">
      <DisplayName
        value={row.name}
        className="block font-mono text-[12px] font-semibold text-text"
      />
      <div className="mt-0.5 flex min-w-0 gap-1 text-[11px] text-muted">
        <DisplayName value={metric.label} />
        <span className="shrink-0">
          {metric.units ? `(${metric.units}) ` : ''}· {directionText(metric)} ·{' '}
          {toleranceText(metric)}
        </span>
      </div>
      <table className="mt-2 w-full border-collapse font-mono text-[11px]">
        <tbody>
          <tr>
            <td className="py-0.5 pr-2">
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-baseline" />
                <span className="text-text">baseline</span>
              </span>
            </td>
            <td className="w-[84px]">
              <span className="block h-1.5 rounded bg-baseline" style={{ width: width(base) }} />
            </td>
            <td className="pl-2 text-right text-text">{formatValue(base, metric)}</td>
            <td />
          </tr>
          {runs.map((r) => {
            const cell = row.cells[r.id]?.[metricKey];
            const color = runBg(allRuns.indexOf(r));
            const tone =
              cell?.verdict === 'better'
                ? 'text-better'
                : cell?.verdict === 'worse' || cell?.verdict === 'mismatch'
                  ? 'text-worse'
                  : 'text-faint';
            return (
              <tr key={r.id}>
                <td className="max-w-[110px] py-0.5 pr-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
                    <DisplayName value={r.label} className="text-text" />
                  </span>
                </td>
                <td className="w-[84px]">
                  <span
                    className={`block h-1.5 rounded ${color}`}
                    style={{ width: width(cell?.value ?? null) }}
                  />
                </td>
                {cell && cell.verdict !== 'missing' ? (
                  <>
                    <td className="pl-2 text-right text-text">{formatValue(cell.value, metric)}</td>
                    <td className={`pl-2 text-right ${tone}`}>{formatDelta(cell.delta, metric)}</td>
                  </>
                ) : (
                  <td colSpan={2} className="pl-2 text-right text-faint">
                    —missing
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-faint">Click to open in Table</p>
    </Tooltip>
  );
}
