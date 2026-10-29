import { describe, expect, it } from 'vitest';
import {
  deltaDomain,
  footnoteLines,
  gridColumns,
  groupedBands,
  linear,
  MONO_10PX_CHAR_PX,
  plainTick,
  signedTick,
  spreadLabels,
  tickDecimals,
  trendX,
  valueDomain,
  wrapText,
} from './scales';

describe('valueDomain', () => {
  it('includes zero when asked and pads the free side', () => {
    expect(valueDomain([10, 20], true)).toEqual([0, 21]);
    const [lo, hi] = valueDomain([10, 20], false);
    expect(lo).toBeCloseTo(9.5);
    expect(hi).toBeCloseTo(20.5);
  });
  it('ignores null / non-finite values and handles empty or flat input', () => {
    expect(valueDomain([null, NaN, Infinity], true)).toEqual([0, 1]);
    expect(valueDomain([5, 5], true)).toEqual([0, 5.25]);
    expect(valueDomain([5, 5], false)).toEqual([4.5, 5.5]);
    expect(valueDomain([0], false)).toEqual([-1, 1]);
    expect(valueDomain([-4, -2], true)).toEqual([-4.2, 0]);
  });
});

describe('deltaDomain', () => {
  it('is symmetric around 0 and covers the band half-width', () => {
    const [lo, hi] = deltaDomain([-1, 2, null], 0);
    expect(lo).toBeCloseTo(-hi);
    expect(hi).toBeGreaterThanOrEqual(2);
    const [, wide] = deltaDomain([0.1], 5);
    expect(wide).toBeGreaterThanOrEqual(5);
    expect(deltaDomain([], 0)).toEqual([-1, 1]);
    expect(deltaDomain([0, 0], 0)).toEqual([-1, 1]);
  });
});

describe('scales', () => {
  it('linear nices the domain', () => {
    expect(linear([0, 9.3], [100, 0]).domain()).toEqual([0, 10]);
    expect(linear([0, 9.3], [100, 0], false).domain()).toEqual([0, 9.3]);
  });
  it('grouped bands: one inner band per series inside every outer band', () => {
    const { outer, inner } = groupedBands(['a', 'b'], ['base', 'r1', 'r2'], 400);
    expect(outer.domain()).toEqual(['a', 'b']);
    expect(inner.range()[1]).toBeCloseTo(outer.bandwidth());
    expect(inner.bandwidth() * 3).toBeLessThan(outer.bandwidth());
    expect((outer('b') ?? 0) + outer.bandwidth()).toBeLessThanOrEqual(400);
  });
  it('trend x keeps the step order', () => {
    const x = trendX(['base', 'r1', 'r2'], 300);
    expect(x('base')!).toBeLessThan(x('r1')!);
    expect(x('r1')!).toBeLessThan(x('r2')!);
  });
  it('grid columns', () => {
    expect(gridColumns(1000, 170, 3)).toBe(3);
    expect(gridColumns(1000, 170, 12)).toBe(5);
    expect(gridColumns(100, 170, 4)).toBe(1);
    expect(gridColumns(500, 170, 0)).toBe(1);
  });
});

describe('ticks', () => {
  it('signed ticks use a real minus and no sign for 0', () => {
    expect(signedTick(2)).toBe('+2');
    expect(signedTick(-4)).toBe('−4');
    expect(signedTick(0)).toBe('0');
    expect(signedTick(-0)).toBe('0');
    expect(signedTick(0.5, 1)).toBe('+0.5');
  });
  it('tick decimals and plain ticks', () => {
    expect(tickDecimals([0, 10, 20])).toBe(0);
    expect(tickDecimals([0, 0.5, 1])).toBe(1);
    expect(tickDecimals([0, 0.25, 0.5])).toBe(2);
    expect(plainTick(-2.5, 1)).toBe('−2.5');
    expect(plainTick(10, 0)).toBe('10');
  });
});

describe('wrapText / footnoteLines', () => {
  it('wraps at spaces without splitting words', () => {
    expect(
      wrapText('Grey band = tolerance (±0.1). Click a dot to open the experiment.', 32),
    ).toEqual(['Grey band = tolerance (±0.1).', 'Click a dot to open the', 'experiment.']);
    expect(wrapText('a b c', 100)).toEqual(['a b c']);
    expect(wrapText('', 10)).toEqual([]);
    expect(wrapText('supercalifragilistic x', 5)).toEqual(['supercalifragilistic', 'x']);
  });
  it('keeps the dot-plot footnote inside a 360 px viewport chart and on one line when wide', () => {
    const note = 'Grey band = tolerance (±0.1). Click a dot to open the experiment.';
    const narrow = footnoteLines(note, 279 - 8);
    expect(narrow.length).toBeGreaterThan(1);
    for (const l of narrow) expect(l.length * MONO_10PX_CHAR_PX).toBeLessThanOrEqual(279 - 8);
    expect(footnoteLines(note, 1120)).toEqual([note]);
  });
});

describe('spreadLabels', () => {
  it('keeps labels at least `gap` apart in input order', () => {
    const out = spreadLabels([50, 50, 52, 10], 11, 0, 200);
    expect(out[3]).toBe(10);
    const sorted = [out[0], out[1], out[2]].sort((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBeGreaterThanOrEqual(11);
    expect(sorted[2] - sorted[1]).toBeGreaterThanOrEqual(11);
    expect(out[0]).toBeLessThan(out[1]);
  });
  it('pulls the stack back inside the bottom bound', () => {
    const out = spreadLabels([98, 99, 100], 10, 0, 100);
    expect(Math.max(...out)).toBe(100);
    expect(Math.min(...out)).toBe(80);
  });
  it('untouched when already apart', () => {
    expect(spreadLabels([0, 20, 40], 10, 0, 100)).toEqual([0, 20, 40]);
  });
});
