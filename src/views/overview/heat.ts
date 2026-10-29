import type { Cell, Metric } from '../../model/types';

/**
 * Overview heatmap intensity (spec Phase 3 "Heat step"). The verdict decides the colour family and
 * whether a cell changed; this only decides how strong the fill is. A changed cell is never step 0,
 * so a coloured glyph never sits on the "same" fill.
 */
export type HeatStep = 0 | 1 | 2 | 3;

export function heatStep(cell: Cell, metric: Metric, mode: 'tolerance' | 'percent'): HeatStep {
  if (
    cell.verdict === 'missing' ||
    cell.verdict === 'same' ||
    cell.base == null ||
    cell.delta == null
  )
    return 0;
  const d = Math.abs(cell.delta); // > 0 here, because the verdict is not 'same'
  if (mode === 'tolerance') {
    const tol =
      metric.tolerance_mode === 'percent'
        ? (Math.abs(cell.base) * metric.tolerance) / 100
        : metric.tolerance;
    if (tol === 0) return 3; // r = ∞ when Δ ≠ 0
    const r = d / tol;
    return r <= 2 ? 1 : r <= 5 ? 2 : 3;
  }
  if (cell.base === 0) return 3; // Δ % = ∞
  const p = (d / Math.abs(cell.base)) * 100;
  return p < 5 ? 1 : p < 20 ? 2 : 3;
}
