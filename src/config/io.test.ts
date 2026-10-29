import { describe, expect, it } from 'vitest';
import { readFixture } from '../fixtures/files';
import { v1SmallConfig } from '../fixtures/v1_small.config';
import { builtinConfig } from './builtin';
import { importConfigFile, MAX_CONFIG_BYTES, parseConfigText, toJson, toYaml } from './io';

describe('config io', () => {
  it('round-trips YAML and JSON', () => {
    for (const c of [builtinConfig, v1SmallConfig()]) {
      expect(parseConfigText(toYaml(c), 'c.yaml')).toEqual({ config: c, issues: [] });
      expect(parseConfigText(toJson(c), 'c.JSON')).toEqual({ config: c, issues: [] });
    }
  });

  it('writes keys in schema order with no YAML anchors', () => {
    const y = toYaml(builtinConfig);
    expect(y.startsWith('version: 2\nname: tbp-default\n')).toBe(true);
    expect(y).not.toMatch(/[&*]a\d+\b/); // yaml's default anchor names
    expect(y.indexOf('sources:')).toBeLessThan(y.indexOf('metrics:'));
    expect(y.indexOf('groups:')).toBeLessThan(y.indexOf('charts:'));
    // the leading space of the ycb_unsupervised headers survives
    expect(y).toMatch(/['"] Run Time \(mins\)\|align right['"]/);
  });

  it('refuses files over 1 MB before parsing', () => {
    expect(parseConfigText('x'.repeat(MAX_CONFIG_BYTES + 1), 'c.yaml')).toEqual({
      error: 'Config file is larger than 1 MB',
    });
  });

  it('turns excessive aliases into an error', () => {
    const lines = ['a: &x [1]'];
    for (let i = 0; i < 1000; i++) lines.push(`b${i}: *x`);
    let r: ReturnType<typeof parseConfigText> | undefined;
    expect(() => (r = parseConfigText(lines.join('\n'), 'c.yaml'))).not.toThrow();
    expect(r).toHaveProperty('error');
  });

  it('turns a duplicate key into an error mentioning the line', () => {
    const r = parseConfigText('version: 2\nname: a\nname: b\n', 'c.yaml');
    expect('error' in r && r.error).toMatch(/line 3/);
  });

  it('does not apply YAML merge keys', () => {
    const r = parseConfigText(
      'version: 2\nbase: &b { label: X }\nmetrics:\n  m:\n    <<: *b\n    direction: higher\n',
      'c.yaml',
    );
    expect('config' in r).toBe(true);
    if (!('config' in r)) return;
    expect(r.config.metrics.m.label).toBe('m');
    expect(r.issues.map((i) => i.message)).toContain('metrics.m.<<: unknown key');
  });

  it('reports non-mapping documents and bad JSON', () => {
    expect(parseConfigText('- a\n- b\n', 'c.yaml')).toEqual({ error: 'Config must be a mapping' });
    expect(parseConfigText('{', 'c.json')).toHaveProperty('error');
  });

  it('routes v1 documents through the importer', () => {
    const r = parseConfigText(readFixture('v1_small.yaml'), 'v1_small.yaml');
    expect(r).toEqual({ config: v1SmallConfig(), issues: [] });
  });

  it('importConfigFile refuses errors and passes warnings', () => {
    const bad = toYaml(v1SmallConfig()).replace('decimals: 2', 'decimals: 1000');
    const r1 = importConfigFile(bad, 'c.yaml');
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.message).toBe('Config not imported: 1 error');
      expect(r1.issues.map((i) => i.code)).toEqual(['value-out-of-range']);
    }
    const typo = toYaml(v1SmallConfig()).replace('tolerance: 0.1', 'tolerence: 0.1');
    const r2 = importConfigFile(typo, 'c.yaml');
    expect(r2.ok).toBe(true);
    expect(r2.issues.map((i) => i.code)).toEqual(['unknown-key']);
    const r3 = importConfigFile('{', 'c.json');
    expect(r3).toMatchObject({ ok: false, issues: [] });
  });
});
