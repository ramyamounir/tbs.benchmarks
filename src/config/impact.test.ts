import { describe, expect, it } from 'vitest';
import { compareAll } from '../compare/compare';
import { smallBaseline, smallRun } from '../fixtures/files';
import { v1SmallConfig } from '../fixtures/v1_small.config';
import type { Config } from '../model/types';
import { formatImpact, impactOfChange } from './impact';

const B = 'base_config_10distinctobj_surf_agent';

function withMetric(
  config: Config,
  key: string,
  patch: Partial<Config['metrics'][string]>,
): Config {
  const next = structuredClone(config);
  next.metrics[key] = { ...next.metrics[key], ...patch };
  return next;
}

describe('impactOfChange on the committed fixtures', () => {
  const baseline = smallBaseline();
  const r1 = smallRun('R1');
  const r2 = smallRun('R2');
  const config = v1SmallConfig();

  it('is zero for an unchanged definition', () => {
    expect(impactOfChange(config, config, 'rotation_error', baseline, [r1, r2], {})).toEqual({
      changed: 0,
      runs: 0,
    });
  });

  it('counts the cells whose verdict flips and the runs involved', () => {
    // B: rotation 3.64 → 3.5 is `better` at 0.01 and `same` at 1.
    const before = compareAll(config, baseline, [r1], {});
    const row = before.groups[0].experiments.find((e) => e.name === B)!;
    expect(row.cells[r1.id].rotation_error.verdict).toBe('better');
    const next = withMetric(config, 'rotation_error', { tolerance: 1 });
    expect(impactOfChange(config, next, 'rotation_error', baseline, [r1], {})).toEqual({
      changed: 1,
      runs: 1,
    });
    expect(impactOfChange(config, next, 'rotation_error', baseline, [r1, r2], {})).toEqual({
      changed: 2,
      runs: 2,
    });
  });

  it('follows tolerance mode, direction and the metric key only', () => {
    // percent_correct: B 100 → 90 (worse), C 93.33 (LM_2 override) vs its base.
    const pct = withMetric(config, 'percent_correct', { tolerance: 20, tolerance_mode: 'percent' });
    const res = impactOfChange(config, pct, 'percent_correct', baseline, [r1], {});
    expect(res.changed).toBeGreaterThanOrEqual(1);
    expect(res.runs).toBe(1);
    // The same change seen through another metric's cells changes nothing.
    expect(impactOfChange(config, pct, 'rotation_error', baseline, [r1], {})).toEqual({
      changed: 0,
      runs: 0,
    });
    const flipped = withMetric(config, 'percent_correct', { direction: 'lower' });
    const f = impactOfChange(config, flipped, 'percent_correct', baseline, [r1], {});
    expect(f.changed).toBeGreaterThanOrEqual(1);
  });

  it('counts cells that appear or disappear when a group stops listing the metric', () => {
    const next = structuredClone(config);
    next.groups[0].metrics = ['percent_correct'];
    // The two ycb_10objs experiments lose their rotation_error cell.
    expect(impactOfChange(config, next, 'rotation_error', baseline, [r1], {})).toEqual({
      changed: 2,
      runs: 1,
    });
  });

  it('is zero with no runs and for an unknown metric', () => {
    expect(impactOfChange(config, config, 'rotation_error', baseline, [], {})).toEqual({
      changed: 0,
      runs: 0,
    });
    expect(impactOfChange(config, config, 'nope', baseline, [r1], {})).toEqual({
      changed: 0,
      runs: 0,
    });
  });
});

describe('formatImpact', () => {
  it('formats the line as in the mockup', () => {
    expect(formatImpact({ changed: 9, runs: 3 }, 0.01)).toBe(
      'Changes 9 verdicts across 3 runs · was 0.01',
    );
    expect(formatImpact({ changed: 1, runs: 1 }, '1 %')).toBe(
      'Changes 1 verdict across 1 run · was 1 %',
    );
    expect(formatImpact({ changed: 2, runs: 1 })).toBe('Changes 2 verdicts across 1 run');
    expect(formatImpact({ changed: 0, runs: 0 }, 0.01)).toBe('No verdict changes');
  });
});
