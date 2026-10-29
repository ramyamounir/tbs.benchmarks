import { describe, expect, it } from 'vitest';
import type { Transform } from './types';
import {
  applyTransforms,
  describeTransform,
  pyReplacementToJs,
  roundDecimals,
  roundHalfEven,
  toNumber,
} from './transforms';

// Golden values verified with pandas 2.3.2 / numpy 2.3.3:
// pd.Series([...]).round(d).tolist() (spec Phase 2a "Transforms").
describe('round (pandas half-to-even)', () => {
  it('round 2', () => {
    expect(roundDecimals(0.125, 2)).toBe(0.12);
    expect(roundDecimals(0.135, 2)).toBe(0.14);
    expect(roundDecimals(-0.125, 2)).toBe(-0.12);
    expect(roundDecimals(2.675, 2)).toBe(2.68);
    expect(roundDecimals(1.005, 2)).toBe(1);
  });

  it('round 0', () => {
    expect(roundDecimals(41.5, 0)).toBe(42);
    expect(roundDecimals(42.5, 0)).toBe(42);
    expect(roundDecimals(0.5, 0)).toBe(0);
    expect(roundDecimals(1.5, 0)).toBe(2);
    expect(roundDecimals(-2.5, 0)).toBe(-2);
    const r = roundDecimals(-0.4, 0);
    expect(r).toBe(0);
    expect(Object.is(r, -0)).toBe(false);
  });

  it('roundHalfEven', () => {
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
    expect(roundHalfEven(-3.5)).toBe(-4);
    expect(roundHalfEven(2.4)).toBe(2);
    expect(roundHalfEven(2.6)).toBe(3);
    expect(roundHalfEven(Infinity)).toBe(Infinity);
    expect(roundHalfEven(NaN)).toBeNaN();
  });

  it('[to_number, sec_to_min, round 0] on 2550 s gives 42 (v1)', () => {
    expect(
      applyTransforms('2550', [
        { kind: 'to_number' },
        { kind: 'sec_to_min' },
        { kind: 'round', decimals: 0 },
      ]),
    ).toBe(42);
  });
});

describe('to_number', () => {
  it('accepts plain decimals and strips every %', () => {
    expect(toNumber('95%')).toBe(95);
    expect(toNumber(' 3.5 ')).toBe(3.5);
    expect(toNumber('5%%')).toBe(5);
    expect(toNumber('+5')).toBe(5);
    expect(toNumber('.5')).toBe(0.5);
    expect(toNumber('1e3')).toBe(1000);
    expect(toNumber('-2.')).toBe(-2);
    expect(toNumber(7)).toBe(7);
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it('rejects everything else', () => {
    for (const s of [
      'nan',
      'NaN',
      '',
      'None',
      'NA',
      'null',
      '0x10',
      '1_000',
      '1,000',
      'True',
      'inf',
      'Infinity',
      'abc',
    ]) {
      expect(toNumber(s)).toBeNull();
    }
  });

  it('as a transform', () => {
    expect(applyTransforms('95%', [{ kind: 'to_number' }])).toBe(95);
    expect(applyTransforms('nan', [{ kind: 'to_number' }])).toBeNull();
    expect(applyTransforms('', [{ kind: 'to_number' }])).toBeNull();
    expect(applyTransforms('None', [{ kind: 'to_number' }])).toBeNull();
    expect(applyTransforms('0x10', [{ kind: 'to_number' }])).toBeNull();
    expect(applyTransforms('abc', [{ kind: 'to_number' }])).toBeNull();
  });
});

describe('applyTransforms', () => {
  it('returns null for a missing column without running transforms', () => {
    expect(applyTransforms(undefined, [{ kind: 'lowercase' }])).toBeNull();
    expect(applyTransforms(undefined, [])).toBeNull();
  });

  it('reads an empty cell as NaN (string ops see "nan")', () => {
    expect(applyTransforms('', [])).toBeNull();
    expect(applyTransforms('', [{ kind: 'uppercase' }])).toBe('NAN');
  });

  it('string ops', () => {
    expect(applyTransforms('AbC', [{ kind: 'lowercase' }])).toBe('abc');
    expect(applyTransforms('AbC', [{ kind: 'uppercase' }])).toBe('ABC');
    expect(applyTransforms('  x ', [{ kind: 'trim' }])).toBe('x');
    expect(applyTransforms('LM_2', [{ kind: 'strip_prefix', value: 'LM_' }])).toBe('2');
    expect(applyTransforms('xLM_2', [{ kind: 'strip_prefix', value: 'LM_' }])).toBe('xLM_2');
    expect(applyTransforms('LM_LM_2', [{ kind: 'strip_prefix', value: 'LM_' }])).toBe('LM_2');
    expect(applyTransforms('12 deg', [{ kind: 'strip_suffix', value: ' deg' }])).toBe('12');
    expect(applyTransforms('12', [{ kind: 'strip_suffix', value: '' }])).toBe('12');
    expect(applyTransforms(5 as unknown as string, [{ kind: 'trim' }])).toBe('5');
  });

  it('regex_replace with Python replacement syntax', () => {
    expect(
      applyTransforms('ab', [{ kind: 'regex_replace', pattern: '(a)(b)', replacement: '\\2\\1' }]),
    ).toBe('ba');
    expect(
      applyTransforms('aXa', [{ kind: 'regex_replace', pattern: 'a', replacement: 'b' }]),
    ).toBe('bXb');
    expect(
      applyTransforms('ab', [
        { kind: 'regex_replace', pattern: '(?P<x>a)', replacement: '\\g<x>\\g<0>$' },
      ]),
    ).toBe('aa$b');
    expect(
      applyTransforms('a1', [{ kind: 'regex_replace', pattern: '\\d', replacement: '' }]),
    ).toBe('a');
  });

  it('a rejected regex_replace pattern yields null, never a throw', () => {
    expect(
      applyTransforms('aaa', [{ kind: 'regex_replace', pattern: '(a+)+$', replacement: '' }]),
    ).toBeNull();
    expect(
      applyTransforms('aaa', [{ kind: 'regex_replace', pattern: '[unclosed', replacement: '' }]),
    ).toBeNull();
  });

  it('unit conversions', () => {
    expect(applyTransforms('3.141592653589793', [{ kind: 'rad_to_deg' }])).toBeCloseTo(180, 10);
    expect(applyTransforms('180', [{ kind: 'deg_to_rad' }])).toBeCloseTo(Math.PI, 12);
    expect(applyTransforms('90', [{ kind: 'sec_to_min' }])).toBe(1.5);
    expect(applyTransforms('1.5', [{ kind: 'min_to_sec' }])).toBe(90);
    expect(applyTransforms('0.25', [{ kind: 'frac_to_percent' }])).toBe(25);
    expect(applyTransforms('25', [{ kind: 'percent_to_frac' }])).toBe(0.25);
    expect(applyTransforms('x', [{ kind: 'sec_to_min' }])).toBeNull();
  });

  it('scale and clip', () => {
    expect(applyTransforms('10', [{ kind: 'scale', factor: 0.5 }])).toBe(5);
    expect(applyTransforms('120', [{ kind: 'clip', min: 0, max: 100 }])).toBe(100);
    expect(applyTransforms('-3', [{ kind: 'clip', min: 0, max: 100 }])).toBe(0);
    expect(applyTransforms('-3', [{ kind: 'clip', max: 100 }])).toBe(-3);
    expect(applyTransforms('', [{ kind: 'clip', min: 0 }])).toBeNull();
  });

  it('runs a v1 metric pipeline', () => {
    const t: Transform[] = [
      { kind: 'to_number' },
      { kind: 'clip', min: 0, max: 100 },
      { kind: 'round', decimals: 2 },
    ];
    expect(applyTransforms('29.166666666666668', t)).toBe(29.17);
    expect(applyTransforms('93.33333333333333', t)).toBe(93.33);
  });
});

describe('pyReplacementToJs', () => {
  it('translates left to right', () => {
    expect(pyReplacementToJs('\\\\')).toBe('\\');
    expect(pyReplacementToJs('\\g<0>')).toBe('$&');
    expect(pyReplacementToJs('\\g<2>\\1')).toBe('$2$1');
    expect(pyReplacementToJs('\\g<name>')).toBe('$<name>');
    expect(pyReplacementToJs('a\\nb\\tc')).toBe('a\nb\tc');
    expect(pyReplacementToJs('$1')).toBe('$$1');
  });
});

describe('describeTransform', () => {
  it('gives short chip text', () => {
    expect(describeTransform({ kind: 'round', decimals: 2 })).toBe('round 2');
    expect(describeTransform({ kind: 'clip', min: 0, max: 100 })).toBe('clip 0–100');
    expect(describeTransform({ kind: 'sec_to_min' })).toBe('s → min');
    expect(describeTransform({ kind: 'to_number' })).toBe('to number');
    expect(describeTransform({ kind: 'scale', factor: 2 })).toBe('× 2');
    expect(describeTransform({ kind: 'strip_prefix', value: 'LM_' })).toBe('strip prefix "LM_"');
  });
});
