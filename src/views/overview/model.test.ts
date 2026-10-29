import { describe, expect, it } from 'vitest';
import { compareAll } from '../../compare/compare';
import { smallBaseline, smallRun } from '../../fixtures/files';
import { v1SmallConfig } from '../../fixtures/v1_small.config';
import { initialSession } from '../../state/store';
import { formatDelta, overviewModel } from './model';

describe('overviewModel', () => {
  const config = v1SmallConfig();
  const base = smallBaseline();
  const run = smallRun();
  const cmp = compareAll(config, base, [run], {});
  const ov = () => initialSession().overview;

  it('shows every group and the union of their metrics by default', () => {
    const m = overviewModel(cmp, config, [run], ov());
    expect(m.groups.map((g) => g.group.name)).toEqual(config.groups.map((g) => g.name));
    expect(m.metrics.length).toBeGreaterThan(0);
    expect(m.groups.reduce((n, g) => n + g.rows.length, 0)).toBe(
      config.groups.reduce((n, g) => n + g.experiments.length, 0),
    );
  });

  it('drops the metrics hidden in the Table sidebar (shared visibility)', () => {
    const all = overviewModel(cmp, config, [run], ov());
    const hidden = new Set([all.metrics[0]]);
    const m = overviewModel(cmp, config, [run], ov(), hidden);
    expect(m.metrics).toEqual(all.metrics.slice(1));
  });

  it('drops unchecked groups', () => {
    const o = { ...ov(), groups: new Set([config.groups[0].name]) };
    const m = overviewModel(cmp, config, [run], o);
    expect(m.groups.map((g) => g.group.name)).not.toContain(config.groups[0].name);
  });

  it('only rows with regressions keeps rows with a worse or mismatch cell', () => {
    const m = overviewModel(cmp, config, [run], { ...ov(), onlyRegressions: true });
    for (const g of m.groups) {
      for (const r of g.rows) {
        const verdicts = Object.values(r.cells[run.id]).map((c) => c.verdict);
        expect(verdicts.some((v) => v === 'worse' || v === 'mismatch')).toBe(true);
      }
    }
  });

  it('hide metrics within tolerance keeps only changed columns', () => {
    const m = overviewModel(cmp, config, [run], { ...ov(), hideWithinTol: true });
    for (const k of m.metrics) {
      const changed = m.groups.some((g) =>
        g.rows.some((r) => ['better', 'worse', 'mismatch'].includes(r.cells[run.id][k]?.verdict)),
      );
      expect(changed).toBe(true);
    }
  });
});

describe('formatDelta', () => {
  const metric = {
    label: 'x',
    direction: 'lower' as const,
    tolerance: 0,
    tolerance_mode: 'absolute' as const,
    decimals: 2,
    columns: {},
  };
  it('signs the delta', () => {
    expect(formatDelta(-2.29, metric)).toBe('−2.29');
    expect(formatDelta(0.5, metric)).toBe('+0.50');
    expect(formatDelta(0, metric)).toBe('±0.00');
    expect(formatDelta(0.001, metric)).toBe('±0.00');
    expect(formatDelta(null, metric)).toBe('—');
  });
});
