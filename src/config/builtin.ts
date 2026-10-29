import type { Config, Group, Metric, Transform } from '../model/types';
import { emptyConfig } from '../model/types';

/**
 * The built-in `tbp-default` config (spec Phase 2b "Built-in tbp-default"): a snapshot of the 7
 * tables in `tbp.monty/benchmarks/` (one group per table, experiments in file order) with the
 * metric columns and transforms of v1 `configs_repo_wandb.yaml`, corrected: `num_episodes` is a
 * `match` metric and the v1 `lm2_*` metrics are `LM_2` column overrides on the cows groups (the
 * compositional-model successors of v1's `logos_on_objects`, which has no table any more). When the
 * benchmark tables change, update this by hand; users get current tables via "Generate config".
 */

const T: Transform = { kind: 'to_number' };
const R = (decimals: number): Transform => ({ kind: 'round', decimals });
const C: Transform = { kind: 'clip', min: 0, max: 100 };

function metric(
  label: string,
  units: string | undefined,
  direction: Metric['direction'],
  tolerance: number,
  decimals: number,
  repo: [string, Transform[]],
  wandb?: [string, Transform[]],
): Metric {
  const columns: Metric['columns'] = { repo: { column: repo[0], transforms: repo[1] } };
  if (wandb) columns.wandb = { column: wandb[0], transforms: wandb[1] };
  const m: Metric = { label, direction, tolerance, tolerance_mode: 'absolute', decimals, columns };
  return units === undefined
    ? m
    : { label, units, direction, tolerance, tolerance_mode: 'absolute', decimals, columns };
}

const YCB_METRICS = [
  'percent_correct',
  'used_mlh',
  'match_steps',
  'rotation_error',
  'runtime',
  'episode_runtime',
  'num_episodes',
];
const COWS_METRICS = [
  'percent_correct',
  'used_mlh',
  'match_steps',
  'rotation_error',
  'prediction_error',
  'runtime',
  'num_episodes',
];
/** The v1 `lm2_*` columns, as overrides of the wandb side (a fresh object per group). */
function LM2(): Group['column_overrides'] {
  return {
    percent_correct: { wandb: 'LM_2/overall/percent_correct' },
    used_mlh: { wandb: 'LM_2/overall/percent_used_mlh_after_timeout' },
    rotation_error: { wandb: 'LM_2/overall/avg_rotation_error' },
    prediction_error: { wandb: 'LM_2/overall/avg_prediction_error' },
  };
}

function buildBuiltin(): Config {
  const base = emptyConfig();
  return {
    version: 2,
    name: 'tbp-default',
    description: 'tbp.monty benchmark tables vs wandb exports',
    sources: base.sources,
    metrics: {
      percent_correct: metric(
        'Correct',
        '%',
        'higher',
        0.1,
        2,
        ['Correct (%)|align right', [T, C, R(2)]],
        ['overall/percent_correct', [T, C, R(2)]],
      ),
      used_mlh: metric(
        'Used MLH',
        '%',
        'lower',
        0.1,
        2,
        ['Used MLH (%)|align right', [T, R(2)]],
        ['overall/percent_used_mlh_after_timeout', [T, R(2)]],
      ),
      match_steps: metric(
        'Match steps',
        undefined,
        'lower',
        0.1,
        0,
        ['Num Match Steps|align right', [T, R(0)]],
        ['overall/avg_num_monty_matching_steps', [T, R(0)]],
      ),
      rotation_error: metric(
        'Rotation error',
        'deg',
        'lower',
        0.01,
        2,
        ['Rotation Error (degrees)|align right', [T, R(2)]],
        ['overall/avg_rotation_error', [T, R(2)]],
      ),
      prediction_error: metric(
        'Prediction error',
        undefined,
        'lower',
        0.01,
        2,
        ['Avg Prediction Error|align right', [T, R(2)]],
        ['overall/avg_prediction_error', [T, R(2)]],
      ),
      runtime: metric(
        'Run time',
        'min',
        'lower',
        0.05,
        0,
        ['Run Time (mins)|align right', [T, R(0)]],
        ['Runtime', [T, { kind: 'sec_to_min' }, R(0)]],
      ),
      episode_runtime: metric(
        'Episode time',
        'sec',
        'lower',
        0.05,
        0,
        ['Episode Run Time (s)|align right', [T, R(0)]],
        ['overall/avg_episode_run_time', [T, R(0)]],
      ),
      num_episodes: metric(
        'Episodes',
        undefined,
        'match',
        0,
        0,
        ['Num Episodes|hidden', [T, R(0)]],
        ['overall/num_episodes', [T, R(0)]],
      ),
      // Repo-only metrics of ycb_unsupervised; the leading space is part of the real header.
      correct_first_epoch: metric('Correct, 1st epoch', '%', 'higher', 0.1, 2, [
        ' Correct - 1st Epoch(%)|align right',
        [T, R(2)],
      ]),
      correct_later_epochs: metric('Correct, later epochs', '%', 'higher', 0.1, 2, [
        ' Correct - >1st Epoch (%)|align right',
        [T, R(2)],
      ]),
      objects_per_graph: metric('Objects per graph', undefined, 'match', 0, 2, [
        ' Mean Objects per Graph|align right',
        [T, R(2)],
      ]),
      graphs_per_object: metric('Graphs per object', undefined, 'match', 0, 2, [
        ' Mean Graphs per Object|align right',
        [T, R(2)],
      ]),
    },
    groups: [
      {
        name: 'ycb_10objs',
        table: 'benchmarks/ycb_10objs.csv',
        metrics: [...YCB_METRICS],
        column_overrides: {},
        experiments: [
          'base_config_10distinctobj_dist_agent',
          'base_config_10distinctobj_surf_agent',
          'randrot_noise_10distinctobj_dist_agent',
          'randrot_noise_10distinctobj_dist_on_distm',
          'randrot_noise_10distinctobj_vocus_on_vocusm',
          'randrot_noise_10distinctobj_surf_agent',
          'randrot_10distinctobj_surf_agent',
          'randrot_noise_10distinctobj_5lms_dist_agent',
          'base_10simobj_surf_agent',
          'randrot_noise_10simobj_dist_agent',
          'randrot_noise_10simobj_surf_agent',
          'randomrot_rawnoise_10distinctobj_surf_agent',
        ],
      },
      {
        name: 'ycb_77objs',
        table: 'benchmarks/ycb_77objs.csv',
        metrics: [...YCB_METRICS],
        column_overrides: {},
        experiments: [
          'base_77obj_dist_agent',
          'base_77obj_surf_agent',
          'randrot_noise_77obj_dist_agent',
          'randrot_noise_77obj_surf_agent',
          'randrot_noise_77obj_5lms_dist_agent',
        ],
      },
      {
        name: 'ycb_unsupervised',
        table: 'benchmarks/ycb_unsupervised.csv',
        metrics: [
          'correct_first_epoch',
          'correct_later_epochs',
          'objects_per_graph',
          'graphs_per_object',
          'runtime',
          'episode_runtime',
          'num_episodes',
        ],
        column_overrides: {
          runtime: { repo: ' Run Time (mins)|align right' },
          episode_runtime: { repo: ' Episode Run Time (s)|align right' },
          num_episodes: { repo: ' Num Episodes|hidden' },
        },
        experiments: [
          'surf_agent_unsupervised_10distinctobj',
          'surf_agent_unsupervised_10distinctobj_noise',
          'surf_agent_unsupervised_10simobj',
        ],
      },
      {
        name: 'ycb_unsupervised_inference',
        table: 'benchmarks/ycb_unsupervised_inference.csv',
        metrics: ['percent_correct', 'match_steps', 'runtime', 'episode_runtime', 'num_episodes'],
        column_overrides: {},
        experiments: [
          'unsupervised_inference_distinctobj_dist_agent',
          'unsupervised_inference_distinctobj_surf_agent',
        ],
      },
      {
        name: 'montymeetsworld',
        table: 'benchmarks/montymeetsworld.csv',
        metrics: [
          'percent_correct',
          'used_mlh',
          'match_steps',
          'runtime',
          'episode_runtime',
          'num_episodes',
        ],
        column_overrides: {},
        experiments: [
          'randrot_noise_sim_on_scan_monty_world',
          'world_image_on_scanned_model',
          'dark_world_image_on_scanned_model',
          'bright_world_image_on_scanned_model',
          'hand_intrusion_world_image_on_scanned_model',
          'multi_object_world_image_on_scanned_model',
        ],
      },
      {
        name: 'cows_small',
        table: 'benchmarks/cows_small.csv',
        metrics: [...COWS_METRICS],
        column_overrides: LM2(),
        experiments: [
          'base_infer_cows_small_monolithic',
          'base_infer_cows_small_compositional',
          'randrot_noise_infer_cows_small_monolithic',
          'randrot_noise_infer_cows_small_compositional',
        ],
      },
      {
        name: 'cows_large',
        table: 'benchmarks/cows_large.csv',
        metrics: [...COWS_METRICS],
        column_overrides: LM2(),
        experiments: [
          'base_infer_cows_large_monolithic',
          'base_infer_cows_large_compositional',
          'randrot_noise_infer_cows_large_monolithic',
          'randrot_noise_infer_cows_large_compositional',
          'base_infer_cows_large_monolithic_random_locs',
          'base_infer_cows_large_compositional_random_locs',
        ],
      },
    ],
    charts: [
      {
        id: 'c1',
        type: 'grouped_bars',
        metric: 'rotation_error',
        group: 'ycb_77objs',
        experiments: null,
        options: { toleranceBand: true, deltaLabels: true, yFromZero: true },
      },
      {
        id: 'c2',
        type: 'delta_dots',
        metric: 'percent_correct',
        group: 'ycb_10objs',
        experiments: null,
        options: { toleranceBand: true, deltaLabels: true, yFromZero: true },
      },
      {
        id: 'c3',
        type: 'trend',
        metric: 'runtime',
        group: 'ycb_77objs',
        experiments: null,
        options: { toleranceBand: true, deltaLabels: true, yFromZero: true },
      },
    ],
    output: base.output,
  };
}

/**
 * The built-in config. Shared and treated as immutable: callers that edit a config work on the
 * store's copy (every edit builds new objects), never on this value; `builtinConfigCopy()` gives a
 * fresh object for code that needs one.
 */
export const builtinConfig: Config = buildBuiltin();

export function builtinConfigCopy(): Config {
  return buildBuiltin();
}
