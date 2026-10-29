import type { Config } from '../model/types';

/**
 * Hand-written v2 equivalent of `v1_small.yaml` (spec Phase 2a "Fixtures"), so the engine tests need
 * no YAML import. Phase 2b asserts `importV1(v1_small.yaml)` deep-equals this literal: metrics keyed
 * by v1 `output_name`, the `lm2_percent_correct` variant folded into a `column_overrides` entry on
 * the group whose experiment referenced it, one group per (baseline file, proposed file, variants).
 */
export function v1SmallConfig(): Config {
  return {
    version: 2,
    name: 'v1-import',
    sources: {
      repo: { id_column: 'Experiment', match: 'exact' },
      wandb: { id_column: 'Name', match: 'suffix' },
    },
    metrics: {
      percent_correct: {
        label: 'Correct',
        units: '%',
        direction: 'higher',
        tolerance: 0.1,
        tolerance_mode: 'absolute',
        decimals: 2,
        columns: {
          repo: {
            column: 'Correct (%)|align right',
            transforms: [
              { kind: 'to_number' },
              { kind: 'clip', min: 0, max: 100 },
              { kind: 'round', decimals: 2 },
            ],
          },
          wandb: {
            column: 'overall/percent_correct',
            transforms: [
              { kind: 'to_number' },
              { kind: 'clip', min: 0, max: 100 },
              { kind: 'round', decimals: 2 },
            ],
          },
        },
      },
      rotation_error: {
        label: 'Rotation error',
        units: 'deg',
        direction: 'lower',
        tolerance: 0.01,
        tolerance_mode: 'absolute',
        decimals: 2,
        columns: {
          repo: {
            column: 'Rotation Error (degrees)|align right',
            transforms: [{ kind: 'to_number' }, { kind: 'round', decimals: 2 }],
          },
          wandb: {
            column: 'overall/avg_rotation_error',
            transforms: [{ kind: 'to_number' }, { kind: 'round', decimals: 2 }],
          },
        },
      },
    },
    groups: [
      {
        name: 'ycb_10objs',
        table: 'benchmarks/ycb_10objs.csv',
        metrics: ['percent_correct', 'rotation_error'],
        column_overrides: {},
        experiments: [
          'base_config_10distinctobj_dist_agent',
          'base_config_10distinctobj_surf_agent',
        ],
      },
      {
        name: 'montymeetsworld',
        table: 'benchmarks/montymeetsworld.csv',
        metrics: ['percent_correct'],
        column_overrides: { percent_correct: { wandb: 'LM_2/overall/percent_correct' } },
        experiments: ['randrot_noise_sim_on_scan_monty_world'],
      },
    ],
    charts: [],
    output: {
      markdown: {
        float_precision: 2,
        include_units_in_headers: true,
        show_deltas: true,
        show_pass_fail: true,
        symbols: { same: '⬜', better: '✅', worse: '❌', mismatch: '⚠️', missing: '—' },
      },
    },
  };
}

/** A fresh copy per access (tests mutate their own copy). */
export const v1Small: Config = v1SmallConfig();
