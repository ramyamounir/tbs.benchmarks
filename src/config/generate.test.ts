import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv/parse';
import { REPO_HEADERS, WANDB_PR_1184_HEADER } from '../fixtures/headers';
import { synthBaselineFiles, synthWandbCsv } from '../fixtures/synthWandb';
import { buildSource } from '../model/source';
import type { Source } from '../model/types';
import { builtinConfig } from './builtin';
import {
  generateConfig,
  matchColumns,
  normalizeHeader,
  proposeChoices,
  stripRunId,
  unmatchedColumns,
} from './generate';
import { validateConfig } from './schema';
import { configIssues } from './validate';

const header = (line: string): string[] => parseCsv(line).header;
const repoHeaders = Object.values(REPO_HEADERS).flatMap(header);
const wandbHeaders = header(WANDB_PR_1184_HEADER);
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

function sources(): { baseline: Source; runs: Source[] } {
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

describe('normalizeHeader', () => {
  it('normalises both header styles to the same name', () => {
    expect(normalizeHeader('Run Time (mins)|align right')).toBe('runtime');
    expect(normalizeHeader(' Run Time (mins)|align right')).toBe('runtime');
    expect(normalizeHeader('Runtime')).toBe('runtime');
    expect(normalizeHeader('Num Episodes|hidden')).toBe('numepisodes');
    expect(normalizeHeader('overall/num_episodes')).toBe('numepisodes');
    expect(normalizeHeader('overall/avg_prediction_error')).toBe('avgpredictionerror');
  });
});

describe('matchColumns', () => {
  const guesses = matchColumns(repoHeaders, wandbHeaders);

  it('proposes the 8 shared metrics with the built-in columns', () => {
    expect(guesses.map((g) => g.key)).toEqual(SHARED);
    for (const g of guesses) {
      const m = builtinConfig.metrics[g.key];
      expect(g.known).toBe(true);
      expect(g.repo?.column, g.key).toBe(m.columns.repo?.column);
      expect(g.wandb?.column, g.key).toBe(m.columns.wandb?.column);
      expect(g.direction, g.key).toBe(m.direction);
    }
    const runtime = guesses.find((g) => g.key === 'runtime')!;
    expect(runtime.wandb?.transforms).toEqual([
      { kind: 'to_number' },
      { kind: 'sec_to_min' },
      { kind: 'round', decimals: 0 },
    ]);
    expect(runtime.repo?.transforms).toEqual([
      { kind: 'to_number' },
      { kind: 'round', decimals: 0 },
    ]);
    const episodes = guesses.find((g) => g.key === 'num_episodes')!;
    expect(episodes.repo?.column).toBe('Num Episodes|hidden');
    expect(episodes.direction).toBe('match');
    const correct = guesses.find((g) => g.key === 'percent_correct')!;
    expect(correct.wandb?.transforms).toContainEqual({ kind: 'clip', min: 0, max: 100 });
  });

  it('collects the LM_2 columns as per-LM variants', () => {
    const variants = Object.fromEntries(guesses.map((g) => [g.key, g.variants]));
    expect(variants.percent_correct).toEqual(['LM_2/overall/percent_correct']);
    expect(variants.rotation_error).toEqual(['LM_2/overall/avg_rotation_error']);
    expect(variants.prediction_error).toEqual(['LM_2/overall/avg_prediction_error']);
    expect(variants.used_mlh).toEqual(['LM_2/overall/percent_used_mlh_after_timeout']);
  });

  it('lists never-matched columns', () => {
    const u = unmatchedColumns(repoHeaders, wandbHeaders, guesses);
    expect(u.repo).toEqual([
      ' Correct - 1st Epoch(%)|align right',
      ' Correct - >1st Epoch (%)|align right',
      ' Mean Objects per Graph|align right',
      ' Mean Graphs per Object|align right',
    ]);
    expect(u.wandb).toEqual([]);
  });

  it('pairs unknown columns by normalised name with a guessed direction', () => {
    const g = matchColumns(['Experiment', 'Mean Loss|align right'], ['Name', 'overall/mean_loss']);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({
      key: 'mean_loss',
      direction: 'lower',
      tolerance: 0.1,
      known: false,
    });
    expect(g[0].wandb?.column).toBe('overall/mean_loss');
  });

  it('proposes every column of a single-kind setup', () => {
    const g = matchColumns(header(REPO_HEADERS['benchmarks/ycb_unsupervised.csv']), []);
    expect(g.map((x) => x.key)).toEqual([
      'runtime',
      'episode_runtime',
      'num_episodes',
      'correct_1st_epoch',
      'correct_1st_epoch_2',
      'mean_objects_per_graph',
      'mean_graphs_per_object',
    ]);
    expect(g.every((x) => x.wandb === null)).toBe(true);
  });
});

describe('generateConfig', () => {
  it('creates one group per baseline table with exactly its experiments', () => {
    const s = sources();
    const choices = proposeChoices(s);
    const c = generateConfig(s, choices);
    expect(Object.keys(c.metrics)).toEqual(SHARED);
    expect(c.groups.map((g) => g.table)).toEqual(s.baseline.tables.map((t) => t.path));
    for (const g of c.groups) {
      const b = builtinConfig.groups.find((x) => x.table === g.table)!;
      expect(g.name).toBe(b.name);
      expect(g.experiments).toEqual(b.experiments);
      if (g.name !== 'ycb_unsupervised') expect(g.metrics, g.name).toEqual(b.metrics);
    }
    const unsup = c.groups.find((g) => g.name === 'ycb_unsupervised')!;
    expect(unsup.metrics).toEqual(['runtime', 'episode_runtime', 'num_episodes']);
    expect(unsup.column_overrides).toEqual({
      runtime: { repo: ' Run Time (mins)|align right' },
      episode_runtime: { repo: ' Episode Run Time (s)|align right' },
      num_episodes: { repo: ' Num Episodes|hidden' },
    });
    // the generated config is structurally canonical and valid against its sources
    expect(validateConfig(c)).toEqual({ config: c, issues: [] });
    expect(configIssues(c, [s.baseline, ...s.runs]).filter((i) => i.severity === 'error')).toEqual(
      [],
    );
  });

  it('applies chosen variant groups, renames and exclusions', () => {
    const s = sources();
    const choices = proposeChoices(s);
    choices.groups = choices.groups!.map((g) =>
      g.name === 'cows_small' ? { ...g, name: 'cows' } : { ...g, include: g.name !== 'ycb_77objs' },
    );
    choices.variantGroups = { percent_correct: ['cows'], used_mlh: ['cows'] };
    const c = generateConfig(s, { ...choices, name: 'mine' });
    expect(c.name).toBe('mine');
    expect(c.groups.map((g) => g.name)).not.toContain('ycb_77objs');
    expect(c.groups.find((g) => g.name === 'cows')?.column_overrides).toEqual({
      percent_correct: { wandb: 'LM_2/overall/percent_correct' },
      used_mlh: { wandb: 'LM_2/overall/percent_used_mlh_after_timeout' },
    });
  });

  it('can collect run experiments matched by no group', () => {
    const s = sources();
    const extraRun = buildSource(
      [
        {
          path: 'x.csv',
          text: `${WANDB_PR_1184_HEADER}\nbase_77obj_dist_agent_ab12cd34\nnew_experiment_k3b9xq2e\n`,
          lastModified: 0,
        },
      ],
      { label: 'x', origin: 'local' },
    ).source!;
    const c = generateConfig(
      { baseline: s.baseline, runs: [extraRun] },
      { ...proposeChoices(s), wandbOnly: 'group' },
    );
    expect(c.groups.at(-1)).toMatchObject({
      name: 'wandb-only',
      table: null,
      experiments: ['new_experiment'],
    });
  });

  it('builds a single wandb group for a wandb baseline', () => {
    const rows = ['a_99l2zpjy', 'a_guibpwnr', 'b', 'c_k3b9xq2e', 'random_location'];
    const baseline = buildSource(
      [{ path: 'b.csv', text: [WANDB_PR_1184_HEADER, ...rows].join('\n'), lastModified: 0 }],
      { label: 'b', origin: 'local' },
    ).source!;
    const c = generateConfig({ baseline, runs: [] }, proposeChoices({ baseline, runs: [] }));
    expect(c.groups).toHaveLength(1);
    expect(c.groups[0]).toMatchObject({
      name: 'wandb',
      table: null,
      experiments: ['a', 'b', 'c', 'random_location'],
    });
    expect(c.groups[0].metrics).toEqual(SHARED);
  });

  it('strips run-id suffixes only when they look like ids', () => {
    expect(stripRunId('dark_world_99l2zpjy')).toBe('dark_world');
    expect(stripRunId('world_image_guibpwnr')).toBe('world_image');
    expect(stripRunId('random_location')).toBe('random_location');
    expect(stripRunId('plain')).toBe('plain');
  });
});
