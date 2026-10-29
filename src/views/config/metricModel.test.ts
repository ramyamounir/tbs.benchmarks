import { describe, expect, it } from 'vitest';
import { smallBaseline, smallRun } from '../../fixtures/files';
import { v1SmallConfig } from '../../fixtures/v1_small.config';
import {
  clipTransform,
  decimalsError,
  defaultTransform,
  editTransforms,
  filterColumns,
  finiteError,
  formatTolerance,
  metricKeyError,
  metricUsage,
  overridesOf,
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

describe('draft validation', () => {
  const config = v1SmallConfig();
  it('checks metric keys (format, reserved, unique)', () => {
    expect(metricKeyError(config, 'rotation_error', 'rotation_error')).toBeNull();
    expect(metricKeyError(config, 'rotation_error', 'rot_err')).toBeNull();
    expect(metricKeyError(config, 'rotation_error', 'Bad-Key')).not.toBeNull();
    expect(metricKeyError(config, 'rotation_error', '__proto__')).not.toBeNull();
    expect(metricKeyError(config, 'rotation_error', 'constructor')).not.toBeNull();
    expect(metricKeyError(config, 'rotation_error', 'percent_correct')).toMatch(/already/);
    expect(metricKeyError(config, 'rotation_error', 'x'.repeat(65))).not.toBeNull();
  });
  it('checks numbers and strings', () => {
    expect(toleranceError('0.5')).toBeNull();
    expect(toleranceError('1e-3')).toBeNull();
    expect(toleranceError('-1')).not.toBeNull();
    expect(toleranceError('abc')).not.toBeNull();
    expect(toleranceError('Infinity')).not.toBeNull();
    expect(toleranceError('')).not.toBeNull();
    expect(decimalsError('0')).toBeNull();
    expect(decimalsError('10')).toBeNull();
    expect(decimalsError('11')).not.toBeNull();
    expect(decimalsError('1.5')).not.toBeNull();
    expect(finiteError('-2.5')).toBeNull();
    expect(finiteError('')).not.toBeNull();
    expect(finiteError('', true)).toBeNull();
    expect(textError('', { required: true })).not.toBeNull();
    expect(textError('x'.repeat(513))).not.toBeNull();
    expect(textError('')).toBeNull();
  });
});

describe('metric edits', () => {
  it('updates one metric in place, keeping order and leaving the input untouched', () => {
    const config = v1SmallConfig();
    const next = updateMetric(config, 'rotation_error', (m) => ({ ...m, tolerance: 1 }));
    expect(Object.keys(next.metrics)).toEqual(Object.keys(config.metrics));
    expect(next.metrics.rotation_error.tolerance).toBe(1);
    expect(config.metrics.rotation_error.tolerance).toBe(0.01);
    expect(next.metrics.percent_correct).toBe(config.metrics.percent_correct);
    expect(updateMetric(config, 'nope', (m) => m)).toBe(config);
  });

  it('sets and removes units', () => {
    const m = v1SmallConfig().metrics.rotation_error;
    expect(withUnits(m, '').units).toBeUndefined();
    expect('units' in withUnits(m, '')).toBe(false);
    expect(withUnits(m, 'rad').units).toBe('rad');
  });

  it('edits columns and transforms per kind', () => {
    const m = v1SmallConfig().metrics.rotation_error;
    const a = setColumn(m, 'wandb', 'LM_2/overall/avg_rotation_error');
    expect(a.columns.wandb?.column).toBe('LM_2/overall/avg_rotation_error');
    expect(a.columns.wandb?.transforms).toEqual(m.columns.wandb?.transforms);
    const b = setColumnSpec(m, 'repo', null);
    expect(Object.keys(b.columns)).toEqual(['wandb']);
    const c = setColumn(b, 'repo', 'X');
    expect(c.columns.repo).toEqual({ column: 'X', transforms: [{ kind: 'to_number' }] });
    const d = editTransforms(m, 'repo', (l) => [...l, defaultTransform('scale', m)]);
    expect(d.columns.repo?.transforms.at(-1)).toEqual({ kind: 'scale', factor: 1 });
    expect(editTransforms(b, 'repo', (l) => l)).toBe(b);
  });

  it('builds default transforms and clip bounds', () => {
    const m = v1SmallConfig().metrics.rotation_error;
    expect(defaultTransform('round', m)).toEqual({ kind: 'round', decimals: 2 });
    expect(defaultTransform('regex_replace', m)).toEqual({
      kind: 'regex_replace',
      pattern: '',
      replacement: '',
    });
    expect(defaultTransform('to_number', m)).toEqual({ kind: 'to_number' });
    expect(clipTransform('0', '')).toEqual({ kind: 'clip', min: 0 });
    expect(clipTransform('', '100')).toEqual({ kind: 'clip', max: 100 });
  });
});

describe('group overrides', () => {
  it('lists, adds, edits and removes overrides', () => {
    const config = v1SmallConfig();
    expect(overridesOf(config, 'percent_correct')).toEqual([
      { group: 'montymeetsworld', kind: 'wandb', column: 'LM_2/overall/percent_correct' },
    ]);
    const added = setOverride(config, 'ycb_10objs', 'rotation_error', 'wandb', 'LM_2/x');
    if (!('config' in added)) throw new Error(added.error);
    expect(overridesOf(added.config, 'rotation_error')).toEqual([
      { group: 'ycb_10objs', kind: 'wandb', column: 'LM_2/x' },
    ]);
    const removed = setOverride(config, 'montymeetsworld', 'percent_correct', 'wandb', null);
    if (!('config' in removed)) throw new Error(removed.error);
    expect(removed.config.groups[1].column_overrides).toEqual({});
    expect(setOverride(config, 'nope', 'percent_correct', 'wandb', 'x')).toHaveProperty('error');
    expect(setOverride(config, 'ycb_10objs', 'nope', 'wandb', 'x')).toHaveProperty('error');
    expect(setOverride(config, 'ycb_10objs', 'percent_correct', 'wandb', '')).toHaveProperty(
      'error',
    );
    expect(Object.getPrototypeOf(config.groups[0].column_overrides)).toBe(Object.prototype);
  });
});

describe('usage, tolerance and samples', () => {
  it('reports usage and formats tolerances', () => {
    const config = v1SmallConfig();
    expect(metricUsage(config, 'percent_correct').groups).toEqual([
      'ycb_10objs',
      'montymeetsworld',
    ]);
    expect(formatTolerance({ tolerance: 0.01, tolerance_mode: 'absolute' })).toBe('0.01');
    expect(formatTolerance({ tolerance: 1, tolerance_mode: 'percent' })).toBe('1 %');
  });

  it('takes the sample from the first source of the kind with a value', () => {
    const config = v1SmallConfig();
    const base = smallBaseline();
    const run = smallRun();
    const m = config.metrics.rotation_error;
    const repo = sampleOf([base, run], m, 'rotation_error', 'repo', config.groups[0]);
    expect(repo).toEqual({ raw: '10.32', value: 10.32, source: base.label });
    const wandb = sampleOf([base, run], m, 'rotation_error', 'wandb', config.groups[0]);
    // The first wandb row's value is the text "NaN" → missing after to_number, as in the engine.
    expect(wandb?.raw).toBe('NaN');
    expect(sampleText(wandb!.value)).toBe('missing');
    // Group override is read for the group's table.
    const pc = sampleOf(
      [run],
      config.metrics.percent_correct,
      'percent_correct',
      'wandb',
      config.groups[1],
    );
    expect(pc?.raw).toBe('93.33333333333333');
    expect(pc?.value).toBe(93.33);
    expect(sampleOf([], m, 'rotation_error', 'repo', null)).toBeNull();
    expect(sampleText('abc')).toBe('"abc"');
  });

  it('splits header suffixes and filters columns', () => {
    expect(splitHeaderSuffix('Correct (%)|align right')).toEqual(['Correct (%)', '|align right']);
    expect(splitHeaderSuffix('Num Episodes|hidden')).toEqual(['Num Episodes', '|hidden']);
    expect(splitHeaderSuffix('overall/x')).toEqual(['overall/x', '']);
    expect(filterColumns(['Alpha', 'beta', 'Gamma'], 'A')).toEqual(['Alpha', 'beta', 'Gamma']);
    expect(filterColumns(['Alpha', 'beta', 'Gamma'], 'gam')).toEqual(['Gamma']);
    expect(filterColumns(['a', 'b', 'c'], '', 2)).toEqual(['a', 'b']);
  });
});
