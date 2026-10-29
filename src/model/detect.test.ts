import { describe, expect, it } from 'vitest';
import { detectKind, findIdColumn, tablePath } from './detect';

describe('detectKind', () => {
  it('detects wandb exports and benchmark tables', () => {
    expect(detectKind(['Name', 'Runtime', 'State', 'overall/percent_correct'])).toBe('wandb');
    expect(detectKind(['Name', 'State'])).toBe('wandb');
    expect(detectKind(['Name', 'Runtime'])).toBe('wandb');
    expect(detectKind(['Experiment', 'Correct (%)|align right'])).toBe('repo');
    expect(detectKind(['Name', 'Value'])).toBe('unknown');
    expect(detectKind([])).toBe('unknown');
  });
});

describe('findIdColumn', () => {
  it('follows the v1 candidate order, then case-insensitive', () => {
    expect(findIdColumn(['Name', 'Experiment'], 'repo')).toBe('Experiment');
    expect(findIdColumn(['x', 'Name'], 'wandb')).toBe('Name');
    expect(findIdColumn(['experiment', 'name'], 'repo')).toBe('experiment');
    expect(findIdColumn(['EXPERIMENT'], 'repo')).toBe('EXPERIMENT');
    expect(findIdColumn(['NAME', 'x'], 'wandb')).toBe('NAME');
    expect(findIdColumn(['x'], 'repo')).toBeNull();
    expect(findIdColumn(['Experiment'], 'unknown')).toBeNull();
  });
});

describe('tablePath', () => {
  it('keeps benchmarks/ and drops other folders', () => {
    expect(tablePath('tbp.monty/benchmarks/ycb_10objs.csv')).toBe('benchmarks/ycb_10objs.csv');
    expect(tablePath('benchmarks/ycb_10objs.csv')).toBe('benchmarks/ycb_10objs.csv');
    expect(tablePath('ycb_10objs.csv')).toBe('ycb_10objs.csv');
    expect(tablePath('exports/pr_1184.csv')).toBe('pr_1184.csv');
    expect(tablePath('a\\benchmarks\\x.csv')).toBe('benchmarks/x.csv');
  });
});
