import { describe, expect, it } from 'vitest';
import { verdictOf } from '../../compare/compare';
import type { Cell, Direction, Metric, RowMatch } from '../../model/types';
import { heatStep } from './heat';

function M(
  tol: number,
  mode: 'absolute' | 'percent' = 'absolute',
  direction: Direction = 'lower',
): Metric {
  return {
    label: 'm',
    direction,
    tolerance: tol,
    tolerance_mode: mode,
    decimals: 2,
    columns: {},
  };
}

const match = (): RowMatch => ({ how: 'exact', index: 0, candidates: [0], chosen: null });

function cell(metric: Metric, base: number, delta: number): Cell {
  const value = base + delta;
  return { base, value, delta, verdict: verdictOf(metric, base, value), match: match() };
}

describe('heatStep', () => {
  it("'tolerance' mode, absolute tolerance 0.1, base 10", () => {
    const m = M(0.1);
    const steps = [0.05, 0.15, 0.2, 0.3, 0.5, 0.6].map((d) => {
      const c = { ...cell(m, 10, d), delta: d }; // exact Δ, not 10 + d − 10
      return heatStep(c, m, 'tolerance');
    });
    expect(cell(m, 10, 0.05).verdict).toBe('same');
    expect(steps).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it('tolerance 0', () => {
    const m = M(0);
    expect(heatStep(cell(m, 10, 1), m, 'tolerance')).toBe(3);
    const same = cell(m, 10, 0);
    expect(same.verdict).toBe('same');
    expect(heatStep(same, m, 'tolerance')).toBe(0);
  });

  it('percent tolerance 10 % of base 50 (tol 5)', () => {
    const m = M(10, 'percent');
    expect([8, 20, 30].map((d) => heatStep(cell(m, 50, d), m, 'tolerance'))).toEqual([1, 2, 3]);
  });

  it("'percent' mode, base 100", () => {
    const m = M(0.1);
    expect([0.5, 3, 10, 25].map((d) => heatStep(cell(m, 100, d), m, 'percent'))).toEqual([
      1, 1, 2, 3,
    ]);
  });

  it("'percent' mode, base 0", () => {
    const m = M(0.1);
    expect(heatStep(cell(m, 0, 1), m, 'percent')).toBe(3);
  });

  it('a missing cell is 0 in both modes', () => {
    const m = M(0.1);
    const c: Cell = { base: null, value: 5, delta: null, verdict: 'missing', match: match() };
    expect(heatStep(c, m, 'tolerance')).toBe(0);
    expect(heatStep(c, m, 'percent')).toBe(0);
  });

  it('a mismatch cell (match metric, tolerance 0, base 100, Δ 2)', () => {
    const m = M(0, 'absolute', 'match');
    const c = cell(m, 100, 2);
    expect(c.verdict).toBe('mismatch');
    expect(heatStep(c, m, 'tolerance')).toBe(3);
    expect(heatStep(c, m, 'percent')).toBe(1);
  });
});
