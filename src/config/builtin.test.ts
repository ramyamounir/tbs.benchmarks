import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv/parse';
import { REPO_HEADERS, WANDB_PR_1184_HEADER } from '../fixtures/headers';
import { buildSource } from '../model/source';
import { BUILTIN_NAME, BUILTIN_VERSION, builtinConfig, builtinVersionOf } from './builtin';
import { configIssues } from './validate';

function sources() {
  // One row per table: the group's first experiment, then '1' in every other column.
  const files = builtinConfig.groups.map((g) => {
    const tablePath = g.table as string;
    const header = REPO_HEADERS[tablePath];
    const cols = parseCsv(header).header.length;
    const row = [g.experiments[0], ...Array<string>(cols - 1).fill('1')].join(',');
    return { path: `tbp.monty/${tablePath}`, text: `${header}\n${row}`, lastModified: 0 };
  });
  const baseline = buildSource(files, { label: 'tbp.monty', origin: 'local' }).source;
  const n = parseCsv(WANDB_PR_1184_HEADER).header.length;
  const row = ['base_77obj_dist_agent', ...Array<string>(n - 1).fill('1')].join(',');
  const run = buildSource(
    [{ path: 'pr_1184.csv', text: `${WANDB_PR_1184_HEADER}\n${row}\n`, lastModified: 0 }],
    { label: 'pr_1184.csv', origin: 'local' },
  ).source;
  if (!baseline || !run) throw new Error('synthetic sources did not build');
  return { baseline, run };
}

describe('builtinConfig', () => {
  it('has no error-severity issue against the 7 tables and a pr_1184 export', () => {
    const { baseline, run } = sources();
    expect(baseline.tables).toHaveLength(7);
    const issues = configIssues(builtinConfig, [baseline, run]);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    // The repo-only ycb_unsupervised metrics are unmapped for wandb, never an error.
    expect(issues.some((i) => i.code === 'source-kind-unmapped')).toBe(true);
  });

  it('has the documented structure', () => {
    const c = builtinConfig;
    expect(c.name).toBe(BUILTIN_NAME);
    expect(c.name).toBe(`tbp-default-v${BUILTIN_VERSION}`);
    expect(c.groups.map((g) => g.table).sort()).toEqual(Object.keys(REPO_HEADERS).sort());
    expect(c.groups.map((g) => g.name)).toEqual([
      'ycb_10objs',
      'ycb_77objs',
      'ycb_unsupervised',
      'ycb_unsupervised_inference',
      'montymeetsworld',
      'cows_small',
      'cows_large',
    ]);
    expect(c.groups.reduce((n, g) => n + g.experiments.length, 0)).toBe(38);
    expect(Object.keys(c.metrics)).toHaveLength(12);
    expect(c.metrics.num_episodes.direction).toBe('match');
    expect(c.groups.some((g) => g.name === 'logos_on_objects')).toBe(false);
    expect(c.charts.map((ch) => [ch.id, ch.type, ch.metric, ch.group])).toEqual([
      ['c1', 'grouped_bars', 'rotation_error', 'ycb_77objs'],
      ['c2', 'delta_dots', 'percent_correct', 'ycb_10objs'],
      ['c3', 'trend', 'runtime', 'ycb_77objs'],
    ]);
  });

  it('resolves every repo column of every group to a real header name', () => {
    for (const g of builtinConfig.groups) {
      const header = REPO_HEADERS[g.table as string].split(',');
      for (const k of g.metrics) {
        const o = Object.hasOwn(g.column_overrides, k) ? g.column_overrides[k].repo : undefined;
        const column = o ?? builtinConfig.metrics[k].columns.repo?.column;
        expect(header, `${g.name}.${k}`).toContain(column);
      }
    }
  });
});

describe('builtinVersionOf', () => {
  it('reads the version from a built-in name', () => {
    expect(builtinVersionOf(BUILTIN_NAME)).toBe(BUILTIN_VERSION);
    expect(builtinVersionOf('tbp-default-v0')).toBe(0);
    expect(builtinVersionOf('tbp-default-v12')).toBe(12);
  });

  it('counts a copy saved before versioning as version 0', () => {
    expect(builtinVersionOf('tbp-default')).toBe(0);
  });

  it('returns null for any other name', () => {
    for (const name of [
      'tbp-default copy',
      'tbp-default-v',
      'tbp-default-v01',
      'tbp-default-v1 copy',
      'tbp-default-v-1',
      'my-config',
      '',
    ]) {
      expect(builtinVersionOf(name), name).toBeNull();
    }
  });
});
