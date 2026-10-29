import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtinConfig } from '../config/builtin';
import { buildSource } from '../model/source';
import type { Verdict } from '../model/types';
import { compareAll } from './compare';

/**
 * v1 parity on the real fixtures (spec Phase 2b; skipped when they are absent). The expected
 * tuples were taken once from v1's Markdown output for the trimmed v1 config, produced with:
 *
 *   cd /home/ramy/tbp/tbp.benchmarks
 *   .venv/bin/python -I -c "import yaml,sys; c=yaml.safe_load(open(sys.argv[1])); \
 *     del c['files']['logos_on_objects_base']; \
 *     c['experiments']=[e for e in c['experiments'] if e['files']['baseline']!='logos_on_objects_base']; \
 *     yaml.safe_dump(c, open(sys.argv[2],'w'), sort_keys=False, allow_unicode=True)" \
 *     configs/configs_repo_wandb.yaml "$TMP/v1_trimmed.yaml"
 *   .venv/bin/python src/tbp/compare.py --baseline ../tbp.monty --proposed wandb_files/pr_1184.csv \
 *     --config "$TMP/v1_trimmed.yaml" --mode table --out "$TMP/v1_out.md"
 *
 * (the unmodified configs_repo_wandb.yaml crashes: FileNotFoundError …/benchmarks/logos_on_objects.csv).
 * v1 output names are v2 keys except `avg_prediction_error` → `prediction_error`. v1 calls a
 * `num_episodes` change better/worse; v2's verdict for that `match` metric is same/mismatch.
 */

const MONTY = '/home/ramy/tbp/tbp.monty/benchmarks';
const PR_1184 = '/home/ramy/tbp/tbp.benchmarks/wandb_files/pr_1184.csv';

const EXPECTED: [experiment: string, metric: string, base: number, value: number, v: Verdict][] = [
  ['base_config_10distinctobj_dist_agent', 'rotation_error', 10.32, 10.29, 'better'],
  ['base_config_10distinctobj_surf_agent', 'rotation_error', 3.64, 3.64, 'same'],
  ['randrot_noise_10distinctobj_dist_agent', 'episode_runtime', 4, 5, 'worse'],
  ['randrot_noise_10distinctobj_dist_on_distm', 'match_steps', 29, 28, 'better'],
  ['base_77obj_dist_agent', 'runtime', 12, 11, 'better'],
  ['randrot_noise_77obj_dist_agent', 'used_mlh', 16.45, 16.02, 'better'],
  ['randrot_noise_77obj_5lms_dist_agent', 'percent_correct', 92.21, 90.91, 'worse'],
  ['unsupervised_inference_distinctobj_dist_agent', 'percent_correct', 100, 98, 'worse'],
  ['unsupervised_inference_distinctobj_dist_agent', 'match_steps', 100, 97, 'better'],
  ['randrot_noise_sim_on_scan_monty_world', 'episode_runtime', 93, 101, 'worse'],
  ['randrot_noise_sim_on_scan_monty_world', 'num_episodes', 120, 120, 'same'],
];

describe('v1 parity (local fixtures)', () => {
  it.skipIf(!existsSync(MONTY) || !existsSync(PR_1184))(
    'reproduces v1 values and verdicts for tbp.monty vs pr_1184.csv',
    () => {
      const files = readdirSync(MONTY)
        .filter((f) => f.endsWith('.csv'))
        .map((f) => ({
          path: `tbp.monty/benchmarks/${f}`,
          text: readFileSync(`${MONTY}/${f}`, 'utf8'),
          lastModified: 0,
        }));
      const baseline = buildSource(files, { label: 'tbp.monty', origin: 'local' }).source!;
      const run = buildSource(
        [{ path: 'pr_1184.csv', text: readFileSync(PR_1184, 'utf8'), lastModified: 0 }],
        { label: 'pr_1184.csv', origin: 'local' },
      ).source!;
      const cmp = compareAll(builtinConfig, baseline, [run], {});
      const rows = new Map(cmp.groups.flatMap((g) => g.experiments).map((r) => [r.name, r]));
      for (const [experiment, metric, base, value, verdict] of EXPECTED) {
        const cell = rows.get(experiment)?.cells[run.id][metric];
        expect(cell, `${experiment} ${metric}`).toBeDefined();
        expect([cell!.base, cell!.value, cell!.verdict], `${experiment} ${metric}`).toEqual([
          base,
          value,
          verdict,
        ]);
      }
      expect(new Set(EXPECTED.map(([e]) => rows.get(e)?.group)).size).toBeGreaterThanOrEqual(4);
    },
  );
});
