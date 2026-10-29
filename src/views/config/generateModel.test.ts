import { describe, expect, it } from 'vitest';
import { builtinConfig } from '../../config/builtin';
import { configIssues } from '../../config/validate';
import { smallBaseline, smallRun } from '../../fixtures/files';
import { synthBaselineFiles, synthWandbCsv } from '../../fixtures/synthWandb';
import { buildSource } from '../../model/source';
import type { Source } from '../../model/types';
import {
  buildConfig,
  choicesOf,
  initialWizardState,
  planNameErrors,
  rowForColumn,
  tableSummaries,
  unmatchedFor,
  variantColumns,
  wandbOnlyCount,
  withRowColumn,
} from './generateModel';

const SHARED = [
  'percent_correct',
  'used_mlh',
  'match_steps',
  'rotation_error',
  'prediction_error',
  'runtime',
  'episode_runtime',
  'num_episodes',
];

function synth(): { baseline: Source; runs: Source[] } {
  const baseline = buildSource(synthBaselineFiles(), {
    label: 'tbp.monty',
    origin: 'local',
  }).source!;
  const run = buildSource([{ path: 'pr_1184.csv', text: synthWandbCsv(100), lastModified: 0 }], {
    label: 'pr_1184.csv',
    origin: 'local',
  }).source!;
  return { baseline, runs: [run] };
}

describe('the Generate wizard model', () => {
  it('starts with the 8 shared metrics checked and one group per baseline table', () => {
    const sources = synth();
    const state = initialWizardState(sources);
    expect(state.rows.filter((r) => r.include).map((r) => r.key)).toEqual(SHARED);
    expect(state.plan.map((p) => p.table)).toEqual(sources.baseline.tables.map((t) => t.path));
    expect(state.plan.every((p) => p.include)).toBe(true);
    expect(state.wandbOnly).toBe('unassigned');
    const runtime = state.rows.find((r) => r.key === 'runtime')!;
    expect(runtime.wandb?.transforms.map((t) => t.kind)).toContain('sec_to_min');
    expect(state.rows.find((r) => r.key === 'num_episodes')!.direction).toBe('match');
  });

  it('creates a config with one group per table holding exactly its experiments', () => {
    const sources = synth();
    const state = initialWizardState(sources);
    const config = buildConfig(sources, state);
    expect(config.name).toBe('tbp.monty');
    expect(Object.keys(config.metrics).slice(0, 8)).toEqual(SHARED);
    expect(config.groups).toHaveLength(builtinConfig.groups.length);
    for (const g of config.groups) {
      const b = builtinConfig.groups.find((x) => x.table === g.table)!;
      expect(new Set(g.experiments)).toEqual(new Set(b.experiments));
    }
    expect(
      configIssues(config, [sources.baseline, ...sources.runs]).filter(
        (i) => i.severity === 'error',
      ),
    ).toEqual([]);
  });

  it('applies the step 3 plan: renamed, excluded groups and name checks', () => {
    const sources = synth();
    const state = initialWizardState(sources);
    state.plan[0] = { ...state.plan[0], name: '  first  ' };
    state.plan[1] = { ...state.plan[1], include: false };
    const config = buildConfig(sources, state);
    expect(config.groups[0].name).toBe('first');
    expect(config.groups.some((g) => g.table === state.plan[1].table)).toBe(false);
    expect(planNameErrors([{ table: 'a', name: '', include: true }])).toEqual([
      'A group needs a name',
    ]);
    expect(
      planNameErrors([
        { table: 'a', name: 'x', include: true },
        { table: 'b', name: 'x', include: true },
        { table: 'c', name: 'x', include: false },
      ]),
    ).toEqual(['Two groups have this name', 'Two groups have this name', null]);
  });

  it('summarises tables, unmatched columns, extra rows and wandb-only experiments', () => {
    const baseline = smallBaseline();
    const run = smallRun();
    const sources = { baseline, runs: [run] };
    expect(tableSummaries(sources)).toEqual([
      { table: 'benchmarks/ycb_10objs.csv', experiments: 3, matchedInRuns: 2 },
      { table: 'benchmarks/montymeetsworld.csv', experiments: 2, matchedInRuns: 1 },
    ]);
    const state = initialWizardState(sources);
    // dark_world_image_on_scanned_model is in the run only.
    expect(wandbOnlyCount(sources, state)).toBe(1);
    expect(buildConfig(sources, { ...state, wandbOnly: 'group' }).groups.at(-1)).toMatchObject({
      name: 'wandb-only',
      experiments: ['dark_world_image_on_scanned_model'],
    });
    const unmatched = unmatchedFor(sources, state.rows);
    expect(unmatched.wandb).not.toContain('overall/percent_correct');
    const extra = rowForColumn('repo', 'Correct (%)|align right', state.rows);
    expect(extra.key).toBe('percent_correct_2');
    expect(extra.include).toBe(true);
    const edited = withRowColumn(state.rows[0], 'wandb', null);
    expect(edited.wandb).toBeNull();
    expect(withRowColumn(edited, 'wandb', 'x').wandb).toEqual({
      column: 'x',
      transforms: [{ kind: 'to_number' }],
    });
  });

  it('offers the per-LM variants as overrides on the chosen groups', () => {
    const baseline = smallBaseline();
    const run = smallRun();
    const sources = { baseline, runs: [run] };
    const state = initialWizardState(sources);
    expect(variantColumns(state.rows)).toContain('LM_2/overall/percent_correct');
    const on = {
      ...state,
      variantsOn: true,
      variantTables: ['benchmarks/montymeetsworld.csv'],
    };
    const choices = choicesOf(on, baseline);
    expect(choices.variantGroups?.percent_correct).toEqual(['montymeetsworld']);
    const config = buildConfig(sources, on);
    const mmw = config.groups.find((g) => g.name === 'montymeetsworld')!;
    expect(mmw.column_overrides.percent_correct).toEqual({
      wandb: 'LM_2/overall/percent_correct',
    });
    const off = buildConfig(sources, { ...on, variantsOn: false });
    expect(off.groups.find((g) => g.name === 'montymeetsworld')!.column_overrides).toEqual({});
  });
});
