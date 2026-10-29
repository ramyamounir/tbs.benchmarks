import { describe, expect, it } from 'vitest';
import {
  emptyConfig,
  type Cell,
  type ChartDef,
  type Comparison,
  type Config,
  type ExperimentRow,
  type Metric,
  type RowMatch,
  type Source,
} from '../model/types';
import {
  barLabel,
  buildChartData,
  defaultTitle,
  deltaAxisLabel,
  deltaLabel,
  effectiveTol,
  subtitleParts,
  toleranceFootnote,
  toleranceLabel,
  trendOrder,
} from './data';

const metric = (over: Partial<Metric> = {}): Metric => ({
  label: 'Rotation error',
  units: 'deg',
  direction: 'higher',
  tolerance: 0.1,
  tolerance_mode: 'absolute',
  decimals: 2,
  columns: {},
  ...over,
});

const match: RowMatch = { how: 'exact', index: 0, candidates: [0], chosen: null };

function source(id: string, date: number | null = null): Source {
  return { id, label: id, kind: 'repo', origin: 'local', tables: [], date, hidden: false };
}

function cell(base: number | null, value: number | null, verdict: Cell['verdict'] = 'same'): Cell {
  return {
    base,
    value,
    delta: base !== null && value !== null ? value - base : null,
    verdict,
    match,
  };
}

function setup(m: Metric, bases: [string, number | null][]) {
  const config: Config = emptyConfig();
  config.metrics = { m: m };
  config.groups = [
    {
      name: 'g',
      table: 'benchmarks/g.csv',
      metrics: ['m'],
      column_overrides: {},
      experiments: bases.map(([n]) => n),
    },
  ];
  const r1 = source('r1');
  const r2 = source('r2');
  const rows: ExperimentRow[] = bases.map(([name, base]) => ({
    name,
    group: 'g',
    baseRow: match,
    cells: {
      r1: { m: cell(base, base === null ? null : base + 1, 'better') },
      r2: { m: cell(base, null, 'missing') },
    },
    episodesMismatch: {},
  }));
  const cmp: Comparison = {
    groups: [{ group: config.groups[0], valid: true, experiments: rows }],
    runs: [],
    unassigned: [],
    missing: [],
  };
  return { config, cmp, runs: [r1, r2] };
}

const chart = (over: Partial<ChartDef> = {}): ChartDef => ({
  id: 'c1',
  type: 'grouped_bars',
  metric: 'm',
  group: 'g',
  experiments: null,
  options: { toleranceBand: true, deltaLabels: true, yFromZero: true },
  ...over,
});

describe('effectiveTol', () => {
  it('absolute mode ignores the baseline value', () => {
    const m = metric({ tolerance: 0.1 });
    expect(effectiveTol(m, 50)).toBe(0.1);
    expect(effectiveTol(m, -3)).toBe(0.1);
    expect(effectiveTol(m, null)).toBe(0.1);
  });
  it('percent mode scales with |baseline|', () => {
    const m = metric({ tolerance: 10, tolerance_mode: 'percent' });
    expect(effectiveTol(m, 50)).toBe(5);
    expect(effectiveTol(m, -50)).toBe(5);
    expect(effectiveTol(m, 0)).toBe(0);
    expect(effectiveTol(m, null)).toBeNull();
    expect(effectiveTol(m, NaN)).toBeNull();
  });
});

describe('labels', () => {
  it('toleranceLabel', () => {
    expect(toleranceLabel(metric({ tolerance: 0.1 }))).toBe('tolerance ±0.1');
    expect(toleranceLabel(metric({ tolerance: 5, tolerance_mode: 'percent' }))).toBe(
      'tolerance ±5 %',
    );
  });
  it('deltaAxisLabel for every direction', () => {
    expect(deltaAxisLabel('higher')).toBe('← worse · better →');
    expect(deltaAxisLabel('lower')).toBe('← better · worse →');
    expect(deltaAxisLabel('match')).toBe('← lower · higher →');
  });
  it('toleranceFootnote', () => {
    expect(toleranceFootnote(metric({ direction: 'higher', tolerance: 0.1 }))).toBe(
      'Grey band = tolerance (±0.1). Click a dot to open the experiment.',
    );
    expect(
      toleranceFootnote(metric({ direction: 'match', tolerance: 5, tolerance_mode: 'percent' })),
    ).toBe(
      'Grey band = must match (±5 % of baseline, per experiment). Click a dot to open the experiment.',
    );
  });
  it('bar and Δ labels use at most one decimal and a real minus', () => {
    const m = metric();
    expect(barLabel(29.27, m)).toBe('29.3');
    expect(barLabel(null, m)).toBe('n/a');
    expect(deltaLabel(-1.43, m)).toBe('−1.4');
    expect(deltaLabel(1.75, m)).toBe('+1.8');
    expect(deltaLabel(0.02, m)).toBe('±0');
    expect(deltaLabel(null, m)).toBe('—');
    expect(deltaLabel(3, metric({ decimals: 0 }))).toBe('+3');
  });
  it('default titles and subtitle parts', () => {
    const m = metric();
    expect(defaultTitle(chart(), m)).toBe('Rotation error by experiment');
    expect(defaultTitle(chart({ type: 'delta_dots' }), m)).toBe('Δ Rotation error vs baseline');
    expect(defaultTitle(chart({ type: 'trend' }), m)).toBe('Rotation error across runs');
    expect(subtitleParts(metric({ direction: 'lower', tolerance: 0.01 }))).toEqual([
      'deg',
      'lower is better',
      'tolerance ±0.01',
    ]);
    expect(subtitleParts(metric({ units: undefined }))).toEqual([
      'higher is better',
      'tolerance ±0.1',
    ]);
  });
});

describe('buildChartData', () => {
  it('carries each experiment effective tolerance (percent mode)', () => {
    const { config, cmp, runs } = setup(metric({ tolerance: 10, tolerance_mode: 'percent' }), [
      ['a', 50],
      ['b', 200],
    ]);
    const data = buildChartData(cmp, config, chart(), runs, runs);
    expect(data.entries.map((e) => e.effectiveTol)).toEqual([5, 20]);
    expect(data.entries.map((e) => e.base)).toEqual([50, 200]);
    expect(data.toleranceMode).toBe('percent');
    expect(data.direction).toBe('higher');
  });
  it('filters experiments (group order), points per visible run, colour index stable', () => {
    const { config, cmp, runs } = setup(metric(), [
      ['a', 1],
      ['b', 2],
      ['c', null],
    ]);
    const data = buildChartData(cmp, config, chart({ experiments: ['c', 'a'] }), [runs[1]], runs);
    expect(data.entries.map((e) => e.name)).toEqual(['a', 'c']);
    expect(data.runs).toEqual([{ id: 'r2', label: 'r2', colorIndex: 1, date: null }]);
    expect(data.entries[0].points.r2.verdict).toBe('missing');
    expect(data.entries[1].effectiveTol).toBe(0.1);
    expect(data.groupFound).toBe(true);
    expect(data.metricInGroup).toBe(true);
  });
  it('flags an unknown group or metric', () => {
    const { config, cmp, runs } = setup(metric(), [['a', 1]]);
    const noGroup = buildChartData(cmp, config, chart({ group: 'zzz' }), runs, runs);
    expect(noGroup.groupFound).toBe(false);
    expect(noGroup.entries).toEqual([]);
    const noMetric = buildChartData(cmp, config, chart({ metric: 'zzz' }), runs, runs);
    expect(noMetric.metric).toBeNull();
    expect(noMetric.metricInGroup).toBe(false);
  });
});

describe('trendOrder', () => {
  it('oldest first, unknown dates last in sidebar order', () => {
    const rs = [
      source('x', null),
      source('a', 30),
      source('b', 10),
      source('y', null),
      source('c', 20),
    ];
    expect(trendOrder(rs).map((r) => r.id)).toEqual(['b', 'c', 'a', 'x', 'y']);
  });
});
