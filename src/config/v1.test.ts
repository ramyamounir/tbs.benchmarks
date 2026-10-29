import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readFixture } from '../fixtures/files';
import { v1SmallConfig } from '../fixtures/v1_small.config';
import type { Config } from '../model/types';
import { parseConfigText, toYaml } from './io';
import { importV1, importV1Value, v1Label } from './v1';

const CONFIGS = '/home/ramy/tbp/tbp.benchmarks/configs';
const METRIC_KEYS = [
  'percent_correct',
  'rotation_error',
  'avg_prediction_error',
  'match_steps',
  'runtime',
  'episode_runtime',
  'used_mlh',
  'num_episodes',
];
const LM2 = {
  percent_correct: { wandb: 'LM_2/overall/percent_correct' },
  used_mlh: { wandb: 'LM_2/overall/percent_used_mlh_after_timeout' },
  rotation_error: { wandb: 'LM_2/overall/avg_rotation_error' },
  avg_prediction_error: { wandb: 'LM_2/overall/avg_prediction_error' },
};
const LOGOS_METRICS = [
  'percent_correct',
  'used_mlh',
  'match_steps',
  'rotation_error',
  'avg_prediction_error',
  'runtime',
  'num_episodes',
];
const FIVE = [
  ['ycb_10objs', 'benchmarks/ycb_10objs.csv', 12],
  ['ycb_77objs', 'benchmarks/ycb_77objs.csv', 5],
  ['ycb_unsupervised_inference', 'benchmarks/ycb_unsupervised_inference.csv', 2],
  ['montymeetsworld', 'benchmarks/montymeetsworld.csv', 6],
  ['logos_on_objects', 'benchmarks/logos_on_objects.csv', 4],
] as const;

type Expected = {
  groups: (readonly [string, string | null, number])[];
  overridesOn: string | null;
};
const EXPECTED: Record<string, Expected> = {
  configs_repo_repo: { groups: [...FIVE], overridesOn: null },
  configs_repo_wandb: { groups: [...FIVE], overridesOn: 'logos_on_objects' },
  configs_wandb_repo: { groups: [...FIVE], overridesOn: 'logos_on_objects' },
  configs_wandb_wandb: {
    groups: [
      ['wandb', null, 25],
      ['wandb-2', null, 4],
    ],
    overridesOn: 'wandb-2',
  },
};

function roundTrip(c: Config): void {
  const back = parseConfigText(toYaml(c), 'export.yaml');
  expect('config' in back).toBe(true);
  if (!('config' in back)) return;
  expect(back.config).toEqual(c);
  expect(back.issues.filter((i) => i.severity === 'error')).toEqual([]);
}

describe('importV1', () => {
  it('imports the trimmed fixture exactly', () => {
    const c = importV1(readFixture('v1_small.yaml'));
    expect(c).toEqual(v1SmallConfig());
    roundTrip(c);
  });

  it('maps labels', () => {
    expect(v1Label('avg_prediction_error')).toBe('Prediction error');
    expect(v1Label('used_mlh')).toBe('Used MLH');
    expect(v1Label('some_new_metric')).toBe('Some new metric');
  });

  it('never throws on a malformed document and throws only on invalid YAML', () => {
    for (const v of [null, 1, {}, { files: 1, metrics: [], experiments: {} }]) {
      expect(() => importV1Value(v)).not.toThrow();
    }
    expect(() => importV1('a: [')).toThrow();
  });

  it('never writes a reserved name into an object', () => {
    const c = importV1Value(
      JSON.parse(
        '{"files":{"b":{"path":"x/benchmarks/t.csv"},"p":{"path":"${P}"}},"metrics":{"__proto__":{"output_name":"x"},"m":{"output_name":"constructor"},"k":{"higher_is_better":true,"tolerance":1,"columns":{"baseline":{"column":"a"},"proposed":{"column":"b"}}}},"experiments":[{"name":"e","files":{"baseline":"b","proposed":"p"},"metrics":["k","__proto__"]}]}',
      ),
    );
    expect(({} as Record<string, unknown>).output_name).toBeUndefined();
    expect(Object.keys(c.metrics)).toEqual(['k']);
    expect(c.groups[0]).toMatchObject({ name: 't', table: 'benchmarks/t.csv', metrics: ['k'] });
  });

  describe.skipIf(!existsSync(CONFIGS))('the four real v1 configs', () => {
    for (const [file, exp] of Object.entries(EXPECTED)) {
      it(file, () => {
        const c = importV1(readFileSync(`${CONFIGS}/${file}.yaml`, 'utf8'));
        expect(c.groups.map((g) => [g.name, g.table, g.experiments.length])).toEqual(exp.groups);
        expect(c.groups.reduce((n, g) => n + g.experiments.length, 0)).toBe(29);
        expect(Object.keys(c.metrics)).toEqual(METRIC_KEYS);
        expect(c.metrics.num_episodes.direction).toBe('match');
        for (const g of c.groups) {
          if (g.name === exp.overridesOn) {
            expect(g.column_overrides).toEqual(LM2);
            expect(g.metrics).toEqual(LOGOS_METRICS);
          } else expect(g.column_overrides).toEqual({});
        }
        roundTrip(c);
      });
    }
  });
});
