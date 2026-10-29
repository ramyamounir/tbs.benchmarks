import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareAll } from '../compare/compare';
import { smallBaseline, smallRun } from '../fixtures/files';
import { v1SmallConfig } from '../fixtures/v1_small.config';
import { emptyConfig } from '../model/types';
import type { Config, ConfigIssue, IssueCode } from '../model/types';
import { builtinConfig } from './builtin';
import { toYaml } from './io';
import { isValidMetricKey, LIMITS, validateConfig } from './schema';
import { configIssues } from './validate';

let protoNames: string[];
beforeAll(() => {
  protoNames = Object.getOwnPropertyNames(Object.prototype).sort();
});
afterAll(() => {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(protoNames);
});

const codes = (issues: ConfigIssue[]): IssueCode[] => issues.map((i) => i.code);

/** A minimal raw config (plain JSON-like object) with one metric `m` and one group `g`. */
function raw(patch: (c: Record<string, unknown>) => void = () => {}): Record<string, unknown> {
  const c = JSON.parse(JSON.stringify(v1SmallConfig())) as Record<string, unknown>;
  patch(c);
  return c;
}
type Rec = Record<string, unknown>;
const metricOf = (c: Rec, key: string): Rec => (c.metrics as Rec)[key] as Rec;
const repoTransforms = (c: Rec, key: string): unknown[] =>
  ((metricOf(c, key).columns as Rec).repo as Rec).transforms as unknown[];

describe('validateConfig: canonical inputs', () => {
  it('returns builtinConfig and emptyConfig() unchanged with no issues', () => {
    for (const c of [builtinConfig, emptyConfig(), v1SmallConfig()]) {
      const r = validateConfig(c);
      expect(r.config).toEqual(c);
      expect(r.issues).toEqual([]);
    }
  });

  it('never throws on junk', () => {
    for (const v of [null, undefined, 1, 'x', [], [1], { version: 2, metrics: [] }]) {
      expect(() => validateConfig(v)).not.toThrow();
      expect(validateConfig(v).config.version).toBe(2);
    }
    expect(codes(validateConfig(null).issues)).toEqual(['value-out-of-range']);
  });

  it('fills missing optional fields silently', () => {
    const r = validateConfig({
      version: 2,
      metrics: {
        m: { label: 'M', direction: 'higher', tolerance: 1, columns: { repo: { column: 'c' } } },
      },
      groups: [{ name: 'g' }],
    });
    expect(r.issues).toEqual([]);
    expect(r.config.metrics.m).toEqual({
      label: 'M',
      direction: 'higher',
      tolerance: 1,
      tolerance_mode: 'absolute',
      decimals: 2,
      columns: { repo: { column: 'c', transforms: [] } },
    });
    expect(r.config.groups[0]).toEqual({
      name: 'g',
      table: null,
      metrics: [],
      column_overrides: {},
      experiments: [],
    });
    expect(r.config.charts).toEqual([]);
    expect(r.config.sources).toEqual(emptyConfig().sources);
    expect(r.config.output).toEqual(emptyConfig().output);
  });

  it('reports version ≠ 2', () => {
    expect(codes(validateConfig(raw((c) => (c.version = 3))).issues)).toEqual([
      'value-out-of-range',
    ]);
  });
});

describe('validateConfig: transforms', () => {
  it('normalises aliases and bare-string kinds to the canonical v1 names', () => {
    const r = validateConfig(
      raw((c) => {
        const t = repoTransforms(c, 'percent_correct');
        t.splice(
          0,
          t.length,
          'to_number',
          { kind: 'strip_prefix', prefix: 'LM_' },
          { kind: 'strip_suffix', suffix: '%', value: 'x' },
          { kind: 'regex_replace', pattern: '(a)', repl: '\\1' },
        );
      }),
    );
    expect(r.issues).toEqual([]);
    expect(r.config.metrics.percent_correct.columns.repo?.transforms).toEqual([
      { kind: 'to_number' },
      { kind: 'strip_prefix', value: 'LM_' },
      { kind: 'strip_suffix', value: 'x' },
      { kind: 'regex_replace', pattern: '(a)', replacement: '\\1' },
    ]);
    const yaml = toYaml(r.config);
    expect(yaml).toContain('value: LM_');
    expect(yaml).toContain('replacement:');
    expect(yaml).not.toMatch(/\b(prefix|suffix|repl):/);
  });

  it('wraps a single transform and defaults params', () => {
    const r = validateConfig(
      raw((c) => {
        ((metricOf(c, 'percent_correct').columns as Rec).repo as Rec).transforms = 'to_number';
        ((metricOf(c, 'rotation_error').columns as Rec).repo as Rec).transforms = [
          { kind: 'round' },
          { kind: 'scale' },
          { kind: 'strip_prefix' },
          { kind: 'clip', max: 5 },
        ];
      }),
    );
    expect(r.issues).toEqual([]);
    expect(r.config.metrics.percent_correct.columns.repo?.transforms).toEqual([
      { kind: 'to_number' },
    ]);
    expect(r.config.metrics.rotation_error.columns.repo?.transforms).toEqual([
      { kind: 'round', decimals: 0 },
      { kind: 'scale', factor: 1 },
      { kind: 'strip_prefix', value: '' },
      { kind: 'clip', max: 5 },
    ]);
  });

  it('drops unknown kinds and wrongly typed params', () => {
    const r = validateConfig(
      raw((c) => {
        const t = repoTransforms(c, 'percent_correct');
        t.push({ kind: 'explode' }, { kind: 'scale', factor: 'x' }, { kind: 'regex_replace' });
      }),
    );
    expect(codes(r.issues)).toEqual([
      'transform-unknown',
      'transform-unknown',
      'transform-unknown',
    ]);
    expect(r.config.metrics.percent_correct.columns.repo?.transforms).toHaveLength(3);
  });

  it('clamps round.decimals', () => {
    const r = validateConfig(
      raw((c) => repoTransforms(c, 'percent_correct').push({ kind: 'round', decimals: 50 })),
    );
    expect(codes(r.issues)).toEqual(['value-out-of-range']);
    expect(r.config.metrics.percent_correct.columns.repo?.transforms.at(-1)).toEqual({
      kind: 'round',
      decimals: 10,
    });
  });

  it('reports extra params of a parameterless kind', () => {
    const r = validateConfig(
      raw((c) => repoTransforms(c, 'percent_correct').push({ kind: 'trim', x: 1 })),
    );
    expect(codes(r.issues)).toEqual(['unknown-key']);
    expect(r.config.metrics.percent_correct.columns.repo?.transforms.at(-1)).toEqual({
      kind: 'trim',
    });
  });
});

describe('validateConfig: regexes', () => {
  const withGroupRegex = (pattern: string) =>
    validateConfig(raw((c) => (((c.groups as Rec[])[0] as Rec).match = { regex: pattern })));

  it('reports invalid, hanging and backreference patterns', () => {
    for (const p of ['[unclosed', '(a+)+$', '(\\w)\\1']) {
      const r = withGroupRegex(p);
      expect(codes(r.issues)).toEqual(['regex-invalid']);
      expect(r.issues[0].message.startsWith(`Invalid regex "${p}": `)).toBe(true);
      expect(r.issues[0].target).toEqual({ kind: 'group', id: 'ycb_10objs' });
      // The pattern is kept (the editor shows it); compareAll treats it as missing.
      expect(r.config.groups[0].match).toEqual({ regex: p });
    }
  });

  it('accepts the documented run-id template', () => {
    expect(withGroupRegex('^{name}(_[a-z0-9]{8})?$').issues).toEqual([]);
  });

  it('reports a bad source-level regex once per group without its own match', () => {
    const r = validateConfig(
      raw((c) => (((c.sources as Rec).wandb as Rec).match = { regex: '(a+)+' })),
    );
    expect(r.issues.map((i) => i.target)).toEqual([
      { kind: 'group', id: 'ycb_10objs' },
      { kind: 'group', id: 'montymeetsworld' },
    ]);
    const none = validateConfig({ version: 2, sources: { repo: { match: { regex: '[' } } } });
    expect(none.issues.map((i) => i.target)).toEqual([{ kind: 'group', id: '' }]);
  });

  it('checks regex_replace patterns', () => {
    const r = validateConfig(
      raw((c) =>
        repoTransforms(c, 'percent_correct').unshift({ kind: 'regex_replace', pattern: '(x*)*' }),
      ),
    );
    expect(codes(r.issues)).toEqual(['regex-invalid']);
    expect(r.issues[0].target).toEqual({ kind: 'metric', id: 'percent_correct' });
  });
});

describe('validateConfig: structural rules', () => {
  it('drops an own __proto__ key without touching any prototype', () => {
    const input = JSON.parse('{"version":2,"metrics":{"__proto__":{"label":"x"}}}');
    const r = validateConfig(input);
    expect(codes(r.issues)).toEqual(['key-reserved']);
    expect(({} as Record<string, unknown>).label).toBeUndefined();
    expect(Object.getPrototypeOf(r.config.metrics)).toBe(Object.prototype);
    expect(Object.keys(r.config.metrics)).toEqual([]);
  });

  it('drops reserved group metric references but keeps unknown ones for configIssues', () => {
    const r = validateConfig(
      raw((c) => (((c.groups as Rec[])[0] as Rec).metrics = ['constructor', 'toString'])),
    );
    expect(codes(r.issues)).toEqual(['key-reserved']);
    expect(r.config.groups[0].metrics).toEqual(['toString']);
    const issues = configIssues(r.config, []);
    expect(issues.some((i) => i.code === 'metric-unknown' && i.message.includes('toString'))).toBe(
      true,
    );
    expect(() => compareAll(r.config, smallBaseline(), [smallRun()], {})).not.toThrow();
  });

  it('rejects reserved and malformed keys in column_overrides and sources', () => {
    const r = validateConfig(
      JSON.parse(
        '{"version":2,"groups":[{"name":"g","column_overrides":{"__proto__":{"repo":"x"},"Bad":{"repo":"y"},"ok":{"wandb":"z","foo":"w"}}}],"sources":{"prototype":{}}}',
      ),
    );
    expect(codes(r.issues).sort()).toEqual([
      'key-reserved',
      'key-reserved',
      'key-reserved',
      'unknown-key',
    ]);
    expect(r.config.groups[0].column_overrides).toEqual({ ok: { wandb: 'z' } });
  });

  it('defaults out-of-range numbers', () => {
    const set = (k: string, v: unknown) =>
      validateConfig(raw((c) => (metricOf(c, 'percent_correct')[k] = v)));
    const d = set('decimals', 1000);
    expect(d.config.metrics.percent_correct.decimals).toBe(2);
    expect(codes(d.issues)).toEqual(['value-out-of-range']);
    for (const v of [-1, NaN, 'abc']) {
      const t = set('tolerance', v);
      expect(t.config.metrics.percent_correct.tolerance).toBe(0);
      expect(codes(t.issues)).toEqual(['value-out-of-range']);
    }
    const fp = validateConfig(
      raw((c) => (((c.output as Rec).markdown as Rec).float_precision = 11)),
    );
    expect(fp.config.output.markdown.float_precision).toBe(2);
    expect(codes(fp.issues)).toEqual(['value-out-of-range']);
  });

  it('drops a malformed metric key', () => {
    const r = validateConfig(raw((c) => ((c.metrics as Rec)['Bad-Key'] = { label: 'x' })));
    expect(codes(r.issues)).toEqual(['key-reserved']);
    expect(Object.hasOwn(r.config.metrics, 'Bad-Key')).toBe(false);
    expect(isValidMetricKey('Bad-Key')).toBe(false);
    expect(isValidMetricKey('__proto__')).toBe(false);
    expect(isValidMetricKey('rot_err')).toBe(true);
  });

  it('reports and drops an unknown key (typo) with its path', () => {
    const r = validateConfig(raw((c) => (metricOf(c, 'percent_correct').tolerence = 0.2)));
    expect(r.issues).toEqual([
      {
        code: 'unknown-key',
        severity: 'warning',
        message: 'metrics.percent_correct.tolerence: unknown key',
        target: { kind: 'metric', id: 'percent_correct' },
      },
    ]);
    expect(r.config.metrics.percent_correct.tolerance).toBe(0.1);
    expect(toYaml(r.config)).not.toContain('tolerence');
  });

  it('caps collection sizes and string lengths', () => {
    const metrics: Rec = {};
    for (let i = 0; i < 201; i++) metrics[`m${i}`] = { label: `M${i}` };
    const r = validateConfig({ version: 2, metrics });
    expect(Object.keys(r.config.metrics)).toHaveLength(LIMITS.metrics);
    expect(codes(r.issues)).toEqual(['value-out-of-range']);

    const long = validateConfig(
      raw((c) => (((c.groups as Rec[])[0] as Rec).experiments = ['x'.repeat(600)])),
    );
    expect(long.config.groups[0].experiments[0]).toHaveLength(512);
    expect(long.issues.map((i) => [i.code, i.severity])).toEqual([
      ['value-out-of-range', 'warning'],
    ]);
  });

  it('regenerates invalid and duplicate chart ids', () => {
    const chart = (id: unknown) => ({
      id,
      type: 'trend',
      metric: 'percent_correct',
      group: 'ycb_10objs',
    });
    const r = validateConfig(
      raw((c) => (c.charts = [chart('c1'), chart('Bad Id!'), chart('c1'), chart(undefined)])),
    );
    expect(r.config.charts.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(r.issues.every((i) => i.code === 'value-out-of-range' && i.severity === 'warning')).toBe(
      true,
    );
    expect(r.issues).toHaveLength(3);
    expect(r.config.charts[0]).toEqual({
      id: 'c1',
      type: 'trend',
      metric: 'percent_correct',
      group: 'ycb_10objs',
      experiments: null,
      options: { toleranceBand: true, deltaLabels: true, yFromZero: true },
    });
  });

  it('drops charts with a bad type and warns on dangling references', () => {
    const r = validateConfig(
      raw(
        (c) =>
          (c.charts = [
            { id: 'a', type: 'pie', metric: 'x', group: 'y' },
            { id: 'b', type: 'trend', metric: 'nope', group: 'nada' },
          ]),
      ),
    );
    expect(r.config.charts.map((c) => c.id)).toEqual(['b']);
    expect(codes(r.issues)).toEqual([
      'value-out-of-range',
      'chart-metric-unknown',
      'chart-group-unknown',
    ]);
    expect(r.issues[1].message).toBe('charts.b: unknown metric "nope"');
  });
});

describe('validateConfig: idempotence', () => {
  const nasty: unknown[] = [
    JSON.parse(
      '{"version":3,"name":5,"__proto__":{"x":1},"metrics":{"__proto__":{},"A":{},"m":{"label":7,"direction":"up","tolerance":-2,"decimals":1.5,"tolerence":1,"columns":{"repo":{"column":"c","transforms":["to_number",{"kind":"round","decimals":99},{"kind":"nope"},{"kind":"regex_replace","pattern":"(a+)+","repl":"x"}]},"foo":{}}}},"groups":[{"name":"g","match":{"regex":"["},"metrics":["m","constructor",3,"zz"],"experiments":["e",1],"extra":1},{"name":""},7],"charts":[{"id":"!!","type":"trend","metric":"m","group":"g"},{"id":"c1","type":"trend","metric":"q","group":"g2"}],"output":{"markdown":{"float_precision":-1,"symbols":{"same":1,"foo":"x"}}}}',
    ),
    raw((c) => (((c.groups as Rec[])[0] as Rec).experiments = ['y'.repeat(700)])),
  ];

  it('a second pass is deep-equal and only reports kept values', () => {
    for (const x of nasty) {
      const once = validateConfig(x);
      const twice = validateConfig(once.config);
      expect(twice.config).toEqual(once.config);
      for (const i of twice.issues) {
        expect(['regex-invalid', 'chart-metric-unknown', 'chart-group-unknown']).toContain(i.code);
      }
    }
  });

  it('returns plain objects only', () => {
    const c: Config = validateConfig(nasty[0]).config;
    expect(Object.getPrototypeOf(c)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(c.metrics)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(c.groups[0].column_overrides)).toBe(Object.prototype);
  });
});
