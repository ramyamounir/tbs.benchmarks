import { describe, expect, it } from 'vitest';
import { fmtNum, formatFixed } from './format';

// Golden values verified with Python 3 (`f'{x:.{d}f}'`), spec Phase 2a "Number formatting".
describe('formatFixed (Python f-string semantics)', () => {
  it('rounds exact ties to even, like Python', () => {
    expect(formatFixed(2.5, 0)).toBe('2');
    expect(formatFixed(3.5, 0)).toBe('4');
    expect(formatFixed(0.5, 0)).toBe('0');
    expect(formatFixed(0.125, 2)).toBe('0.12');
    expect(formatFixed(0.375, 2)).toBe('0.38');
    expect(formatFixed(1.25, 1)).toBe('1.2');
  });

  it('uses the exact binary value for non-ties', () => {
    expect(formatFixed(2.675, 2)).toBe('2.67');
    expect(formatFixed(1.005, 2)).toBe('1.00');
    expect(formatFixed(9.995, 2)).toBe('9.99');
    expect(formatFixed(0.045, 2)).toBe('0.04');
    expect(formatFixed(29.27, 2)).toBe('29.27');
    expect(formatFixed(12345.6789, 10)).toBe('12345.6789000000');
    expect(formatFixed(1e-7, 3)).toBe('0.000');
  });

  it('keeps the sign of negative and -0 values (v1 parity)', () => {
    expect(formatFixed(-0.125, 2)).toBe('-0.12');
    expect(formatFixed(-0.001, 2)).toBe('-0.00');
    expect(formatFixed(-0, 2)).toBe('-0.00');
  });

  it('formats non-finite values like Python', () => {
    expect(formatFixed(NaN, 2)).toBe('nan');
    expect(formatFixed(Infinity, 2)).toBe('inf');
    expect(formatFixed(-Infinity, 2)).toBe('-inf');
  });
});

describe('fmtNum (v1 fmt_num)', () => {
  it('strips trailing zeros and the point', () => {
    expect(fmtNum(0.125, 2)).toBe('0.12');
    expect(fmtNum(29.27, 2)).toBe('29.27');
    expect(fmtNum(100, 2)).toBe('100');
    expect(fmtNum(100, 0)).toBe('100'); // v1 would print '1' (documented deviation)
    expect(fmtNum(-0.001, 2)).toBe('-0');
    expect(fmtNum(3.5, 2)).toBe('3.5');
    expect(fmtNum(-10, 2)).toBe('-10');
  });

  it('prints an em dash for no value', () => {
    expect(fmtNum(null, 2)).toBe('—');
    expect(fmtNum(NaN, 2)).toBe('—');
  });
});
