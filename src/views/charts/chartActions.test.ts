import { describe, expect, it } from 'vitest';
import { builtinConfigCopy } from '../../config/builtin';
import { LIMITS } from '../../config/schema';
import type { ChartDef, Config } from '../../model/types';
import {
  addChart,
  chartForExperiment,
  deleteChart,
  duplicateChart,
  effectiveSelected,
  moveChart,
  newChartId,
  normalizeSelection,
  toggleExperiment,
  toggleGroup,
} from './chartActions';

const cfg = (): Config => builtinConfigCopy();
const byId = (c: Config, id: string) => c.charts.find((x) => x.id === id) as ChartDef;

describe('chart ids and list edits', () => {
  it('newChartId picks the smallest free c<n>', () => {
    const c = cfg();
    expect(newChartId(c.charts)).toBe('c4');
    expect(newChartId(deleteChart(c, 'c2').charts)).toBe('c2');
    expect(newChartId([])).toBe('c1');
  });
  it('addChart uses the template group and a metric that group compares', () => {
    const c = cfg();
    const res = addChart(c, { group: 'ycb_77objs', metric: 'rotation_error' })!;
    expect(res.id).toBe('c4');
    const ch = byId(res.config, 'c4');
    expect(ch).toMatchObject({
      type: 'grouped_bars',
      group: 'ycb_77objs',
      metric: 'rotation_error',
      experiments: null,
    });
    expect(c.charts).toHaveLength(3); // input untouched
  });
  it('addChart refuses past the chart limit', () => {
    const c = cfg();
    while (c.charts.length < LIMITS.charts)
      c.charts.push({ ...c.charts[0], id: newChartId(c.charts) });
    expect(addChart(c)).toBeNull();
    expect(duplicateChart(c, 'c1')).toBeNull();
  });
  it('duplicate inserts after the source; move swaps; delete removes', () => {
    const c = cfg();
    const dup = duplicateChart(c, 'c1')!;
    expect(dup.config.charts.map((x) => x.id)).toEqual(['c1', 'c4', 'c2', 'c3']);
    expect(moveChart(c, 'c2', -1).charts.map((x) => x.id)).toEqual(['c2', 'c1', 'c3']);
    expect(moveChart(c, 'c1', -1)).toBe(c);
    expect(deleteChart(c, 'c2').charts.map((x) => x.id)).toEqual(['c1', 'c3']);
  });
  it('effectiveSelected falls back to the first chart', () => {
    const c = cfg();
    expect(effectiveSelected(c, null)).toBe('c1');
    expect(effectiveSelected(c, 'c3')).toBe('c3');
    expect(effectiveSelected(c, 'gone')).toBe('c1');
    expect(effectiveSelected({ ...c, charts: [] }, null)).toBeNull();
  });
});

describe('experiment selection', () => {
  it('normalizeSelection keeps group order and folds the whole group to null', () => {
    const g = cfg().groups.find((x) => x.name === 'ycb_77objs')!;
    expect(normalizeSelection(g, [g.experiments[2], g.experiments[0]])).toEqual([
      g.experiments[0],
      g.experiments[2],
    ]);
    expect(normalizeSelection(g, [...g.experiments])).toBeNull();
    expect(normalizeSelection(g, [])).toEqual([]);
  });
  it('toggling inside the group / moving to another group', () => {
    const c = cfg();
    const chart = byId(c, 'c1');
    const g77 = c.groups.find((x) => x.name === 'ycb_77objs')!;
    const off = toggleExperiment(c, chart, g77, g77.experiments[0], false);
    expect(off.experiments).toEqual(g77.experiments.slice(1));
    const other = c.groups.find((x) => x.name === 'montymeetsworld')!;
    const moved = toggleExperiment(c, chart, other, other.experiments[1], true);
    expect(moved.group).toBe('montymeetsworld');
    expect(moved.experiments).toEqual([other.experiments[1]]);
    expect(toggleGroup(c, chart, g77, false)).toEqual({ experiments: [] });
    expect(toggleGroup(c, chart, other, true)).toMatchObject({
      group: 'montymeetsworld',
      experiments: null,
    });
    expect(toggleGroup(c, chart, other, false)).toEqual({});
  });
});

describe('chartForExperiment', () => {
  it('creates a grouped-bars chart with just that experiment, then reuses it', () => {
    const c = cfg();
    const g = c.groups.find((x) => x.name === 'ycb_10objs')!;
    const first = chartForExperiment(c, 'ycb_10objs', g.experiments[1])!;
    const ch = byId(first.config, first.id);
    expect(ch).toMatchObject({
      type: 'grouped_bars',
      group: 'ycb_10objs',
      experiments: [g.experiments[1]],
    });
    expect(g.metrics).toContain(ch.metric);
    const again = chartForExperiment(first.config, 'ycb_10objs', g.experiments[1])!;
    expect(again.id).toBe(first.id);
    expect(again.config).toBe(first.config);
    expect(chartForExperiment(c, 'nope', 'x')).toBeNull();
  });
});
