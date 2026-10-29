import { describe, expect, it } from 'vitest';
import { v1SmallConfig } from '../fixtures/v1_small.config';
import type { Config } from '../model/types';
import { builtinConfig } from './builtin';
import { deleteGroup, deleteMetric, renameGroup, renameMetric } from './edit';
import { configIssues } from './validate';

const DANGLING = ['metric-unknown', 'chart-metric-unknown', 'chart-group-unknown'];

/** Run an edit and check the shared guarantees: no mutation, no dangling reference. */
function apply(config: Config, edit: (c: Config) => Config): Config {
  const before = structuredClone(config);
  const result = edit(config);
  expect(config).toEqual(before);
  expect(configIssues(result, []).filter((i) => DANGLING.includes(i.code))).toEqual([]);
  return result;
}

describe('renameMetric', () => {
  it('renames every reference in place', () => {
    const r = apply(builtinConfig, (c) => renameMetric(c, 'rotation_error', 'rot_err'));
    expect(JSON.stringify(r).includes('"rotation_error"')).toBe(false);
    expect(Object.keys(r.metrics)).toEqual(
      Object.keys(builtinConfig.metrics).map((k) => (k === 'rotation_error' ? 'rot_err' : k)),
    );
    builtinConfig.groups.forEach((g, i) => {
      const at = g.metrics.indexOf('rotation_error');
      if (at >= 0) expect(r.groups[i].metrics[at]).toBe('rot_err');
      else expect(r.groups[i]).toBe(g); // unchanged groups are shared
    });
    expect(r.charts.find((c) => c.id === 'c1')?.metric).toBe('rot_err');
    expect(r.metrics.rot_err).toBe(builtinConfig.metrics.rotation_error);
  });

  it('moves a column override in the same key position', () => {
    const r = apply(builtinConfig, (c) => renameMetric(c, 'percent_correct', 'pc'));
    const cows = r.groups.find((g) => g.name === 'cows_small')!;
    expect(Object.keys(cows.column_overrides)[0]).toBe('pc');
    expect(cows.column_overrides.pc).toEqual({ wandb: 'LM_2/overall/percent_correct' });
    expect(Object.hasOwn(cows.column_overrides, 'percent_correct')).toBe(false);
    expect(r.charts.find((c) => c.id === 'c2')?.metric).toBe('pc');
  });

  it('refuses invalid renames with the identical input', () => {
    for (const [from, to] of [
      ['rotation_error', 'runtime'],
      ['rotation_error', 'Bad-Key'],
      ['rotation_error', '__proto__'],
      ['rotation_error', 'rotation_error'],
      ['nope', 'x'],
    ]) {
      expect(renameMetric(builtinConfig, from, to)).toBe(builtinConfig);
    }
  });

  it('works on the v1 fixture', () => {
    const c = v1SmallConfig();
    const r = apply(c, (x) => renameMetric(x, 'percent_correct', 'correct'));
    expect(r.groups[1].column_overrides).toEqual({
      correct: { wandb: 'LM_2/overall/percent_correct' },
    });
    expect(r.groups[0].metrics).toEqual(['correct', 'rotation_error']);
  });
});

describe('deleteMetric', () => {
  it('removes the metric, its references and its charts', () => {
    const r = apply(builtinConfig, (c) => deleteMetric(c, 'rotation_error'));
    expect(Object.hasOwn(r.metrics, 'rotation_error')).toBe(false);
    for (const g of r.groups) {
      expect(g.metrics).not.toContain('rotation_error');
      expect(Object.hasOwn(g.column_overrides, 'rotation_error')).toBe(false);
    }
    expect(r.charts.map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(deleteMetric(builtinConfig, 'nope')).toBe(builtinConfig);
  });

  it('removes the overrides of the v1 fixture', () => {
    const r = apply(v1SmallConfig(), (x) => deleteMetric(x, 'percent_correct'));
    expect(r.groups[1]).toMatchObject({ metrics: [], column_overrides: {} });
  });
});

describe('renameGroup / deleteGroup', () => {
  it('retargets charts on rename', () => {
    const r = apply(builtinConfig, (c) => renameGroup(c, 'ycb_77objs', 'ycb77'));
    expect(r.groups[1].name).toBe('ycb77');
    expect(r.charts.filter((c) => c.group === 'ycb77').map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  it('refuses taken or empty names', () => {
    expect(renameGroup(builtinConfig, 'ycb_77objs', 'ycb_10objs')).toBe(builtinConfig);
    expect(renameGroup(builtinConfig, 'ycb_77objs', '')).toBe(builtinConfig);
    expect(renameGroup(builtinConfig, 'ycb_77objs', '   ')).toBe(builtinConfig);
    expect(renameGroup(builtinConfig, 'ycb_77objs', 'x'.repeat(513))).toBe(builtinConfig);
    expect(renameGroup(builtinConfig, 'nope', 'x')).toBe(builtinConfig);
  });

  it('keeps charts on a remaining group of the same name', () => {
    const dup: Config = {
      ...builtinConfig,
      groups: [...builtinConfig.groups, { ...builtinConfig.groups[1] }],
    };
    const r = renameGroup(dup, 'ycb_77objs', 'ycb77');
    expect(r.charts.find((c) => c.id === 'c1')?.group).toBe('ycb_77objs');
    const d = deleteGroup(dup, 'ycb_77objs');
    expect(d.charts).toHaveLength(3);
  });

  it('deletes a group and its charts, keeping metrics', () => {
    const r = apply(builtinConfig, (c) => deleteGroup(c, 'ycb_77objs'));
    expect(r.groups.map((g) => g.name)).not.toContain('ycb_77objs');
    expect(r.charts.map((c) => c.id)).toEqual(['c2']);
    expect(r.metrics).toBe(builtinConfig.metrics);
    expect(deleteGroup(builtinConfig, 'nope')).toBe(builtinConfig);
  });
});
