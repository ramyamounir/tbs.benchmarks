import { describe, expect, it } from 'vitest';
import { compareAll } from '../../compare/compare';
import { renderMarkdown } from '../../compare/markdown';
import { smallBaseline, smallRun } from '../../fixtures/files';
import { v1SmallConfig } from '../../fixtures/v1_small.config';
import {
  emptyConfig,
  type Cell,
  type Comparison,
  type Config,
  type ExperimentRow,
  type Group,
  type Metric,
  type RowMatch,
  type Source,
  type Verdict,
} from '../../model/types';
import {
  markdownComparison,
  rowFlags,
  runSummary,
  tableModel,
  textMatches,
  visibleMetrics,
  visibleRuns,
  type TableOptions,
} from './filters';

const metric = (direction: Metric['direction'] = 'higher'): Metric => ({
  label: 'm',
  direction,
  tolerance: 0,
  tolerance_mode: 'absolute',
  decimals: 2,
  columns: {},
});

function config(): Config {
  const c = emptyConfig();
  c.metrics = { a: metric(), b: metric('lower'), eps: metric('match') };
  c.groups = [
    group('g1', ['Alpha_one', 'beta_two', 'gamma']),
    group('g2', ['delta', 'ALPHA_three']),
    group('empty', []),
  ];
  return c;
}

function group(name: string, experiments: string[]): Group {
  return {
    name,
    table: `benchmarks/${name}.csv`,
    metrics: ['a', 'b', 'eps'],
    column_overrides: {},
    experiments,
  };
}

const found: RowMatch = { how: 'exact', index: 0, candidates: [0], chosen: 0 };
const none: RowMatch = { how: 'none', index: null, candidates: [], chosen: null };
const dup: RowMatch = { how: 'exact', index: 1, candidates: [1, 4], chosen: 1 };

function cell(verdict: Verdict, match: RowMatch = found): Cell {
  const missing = verdict === 'missing';
  return { base: 1, value: missing ? null : 2, delta: missing ? null : 1, verdict, match };
}

function row(
  name: string,
  g: string,
  perRun: Record<string, Partial<Record<string, Cell>>>,
  baseRow: RowMatch = found,
): ExperimentRow {
  const cells: ExperimentRow['cells'] = {};
  const episodesMismatch: ExperimentRow['episodesMismatch'] = {};
  for (const [id, byMetric] of Object.entries(perRun)) {
    const full: Record<string, Cell> = {
      a: cell('same'),
      b: cell('same'),
      eps: cell('same'),
    };
    for (const [k, c] of Object.entries(byMetric)) if (c) full[k] = c;
    cells[id] = full;
    episodesMismatch[id] = full.eps.verdict === 'mismatch';
  }
  return { name, group: g, baseRow, cells, episodesMismatch };
}

const run = (id: string, hidden = false): Source => ({
  id,
  label: id,
  kind: 'wandb',
  origin: 'local',
  tables: [],
  date: null,
  hidden,
});

const r1 = run('r1');
const r2 = run('r2');
const r3 = run('r3', true);

function comparison(cfg: Config): Comparison {
  const rows: Record<string, ExperimentRow> = {
    Alpha_one: row('Alpha_one', 'g1', { r1: { a: cell('worse') }, r2: {}, r3: {} }),
    beta_two: row('beta_two', 'g1', { r1: { b: cell('better') }, r2: {}, r3: {} }),
    gamma: row('gamma', 'g1', {
      r1: {},
      r2: { a: cell('missing', none), b: cell('missing', none), eps: cell('missing', none) },
      r3: { a: cell('worse') },
    }),
    delta: row('delta', 'g2', { r1: { eps: cell('mismatch') }, r2: { b: cell('worse') }, r3: {} }),
    ALPHA_three: row(
      'ALPHA_three',
      'g2',
      {
        r1: { a: cell('missing', none), b: cell('missing', none), eps: cell('missing', none) },
        r2: { a: cell('better', dup), b: cell('same', dup), eps: cell('same', dup) },
        r3: {},
      },
      none,
    ),
  };
  return {
    groups: cfg.groups.map((g) => ({
      group: g,
      valid: true,
      experiments: g.experiments.map((n) => rows[n]),
    })),
    runs: [r1, r2, r3].map((source) => ({
      source,
      coverage: { found: 0, total: 0, partial: false },
      counts: { same: 0, better: 0, worse: 0, mismatch: 0, missing: 0 },
    })),
    unassigned: [],
    missing: [],
  };
}

const opts = (o: Partial<TableOptions> = {}): TableOptions => ({
  filter: '',
  chip: 'all',
  sort: 'config',
  hiddenGroups: new Set(),
  hiddenMetrics: new Set(),
  ...o,
});

const names = (m: ReturnType<typeof tableModel>) =>
  m.groups.flatMap((g) => g.rows.map((r) => r.row.name));

describe('visibility helpers', () => {
  it('visibleRuns drops hidden runs and keeps order', () => {
    expect(visibleRuns([r1, r3, r2]).map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('visibleMetrics: config order without a group, group order with one, minus hidden', () => {
    const c = config();
    expect(visibleMetrics(c, new Set())).toEqual(['a', 'b', 'eps']);
    expect(visibleMetrics(c, new Set(['b']))).toEqual(['a', 'eps']);
    const g = { ...c.groups[0], metrics: ['eps', 'a', 'eps', 'unknown'] };
    expect(visibleMetrics(c, new Set(['a']), g)).toEqual(['eps']);
  });

  it('textMatches is a case-insensitive substring match; blank matches everything', () => {
    expect(textMatches('Alpha_one', 'ALPHA')).toBe(true);
    expect(textMatches('Alpha_one', 'pha_o')).toBe(true);
    expect(textMatches('Alpha_one', 'beta')).toBe(false);
    expect(textMatches('Alpha_one', '  ')).toBe(true);
  });
});

describe('rowFlags and runSummary', () => {
  const c = config();
  const cmp = comparison(c);
  const [alpha, beta, gamma] = cmp.groups[0].experiments;
  const [delta, alpha3] = cmp.groups[1].experiments;

  it('a regression is a worse or mismatch cell in a visible metric of a visible run', () => {
    expect(rowFlags(alpha, [r1, r2], ['a', 'b', 'eps']).regression).toBe(true);
    expect(rowFlags(alpha, [r1, r2], ['b', 'eps']).regression).toBe(false); // metric hidden
    expect(rowFlags(alpha, [r2], ['a', 'b', 'eps']).regression).toBe(false); // run hidden
    expect(rowFlags(gamma, [r1, r2], ['a']).regression).toBe(false); // only the hidden r3 is worse
    expect(rowFlags(delta, [r1, r2], ['a', 'b', 'eps']).regressions).toBe(2); // mismatch + worse
    expect(rowFlags(beta, [r1], ['a', 'b']).improvement).toBe(true);
  });

  it('missing: no baseline row or a missing cell', () => {
    expect(rowFlags(gamma, [r1, r2], ['a']).missing).toBe(true);
    expect(rowFlags(gamma, [r1], ['a']).missing).toBe(false);
    expect(rowFlags(alpha3, [r2], []).missing).toBe(true); // no baseline row
  });

  it('runSummary counts visible metrics and reports not-in-run, episodes and duplicates', () => {
    const s = runSummary(delta, 'r1', ['a', 'b', 'eps']);
    expect(s.counts).toEqual({ same: 2, better: 0, worse: 0, mismatch: 1, missing: 0 });
    expect(s.episodes).toBe(true);
    expect(s.notInRun).toBe(false);
    expect(runSummary(gamma, 'r2', ['a']).notInRun).toBe(true);
    expect(runSummary(alpha3, 'r2', ['a', 'b']).rows).toBe(2);
    expect(runSummary(alpha3, 'r2', ['a']).counts.better).toBe(1);
  });
});

describe('tableModel', () => {
  const c = config();
  const cmp = comparison(c);
  const runs = visibleRuns([r1, r2, r3]);

  it('shows every group (empty ones included) and counts per chip', () => {
    const m = tableModel(cmp, c, runs, opts());
    expect(m.groups.map((g) => g.group.name)).toEqual(['g1', 'g2', 'empty']);
    expect(m.counts).toEqual({ all: 5, regressions: 2, improvements: 2, missing: 2 });
    expect(m.shown).toBe(5);
  });

  it('chips filter rows; counts stay those of the text-filtered set', () => {
    const m = tableModel(cmp, c, runs, opts({ chip: 'regressions' }));
    expect(names(m)).toEqual(['Alpha_one', 'delta']);
    expect(m.counts.all).toBe(5);
    expect(m.groups.map((g) => g.group.name)).toEqual(['g1', 'g2']); // empty group hidden while filtering
    expect(names(tableModel(cmp, c, runs, opts({ chip: 'improvements' })))).toEqual([
      'beta_two',
      'ALPHA_three',
    ]);
    expect(names(tableModel(cmp, c, runs, opts({ chip: 'missing' })))).toEqual([
      'gamma',
      'ALPHA_three',
    ]);
  });

  it('text filter, chip, hidden metrics, hidden groups and hidden runs compose', () => {
    const m = tableModel(cmp, c, runs, opts({ filter: 'alpha', chip: 'regressions' }));
    expect(names(m)).toEqual(['Alpha_one']);
    expect(m.counts).toEqual({ all: 2, regressions: 1, improvements: 1, missing: 1 });

    const noA = tableModel(
      cmp,
      c,
      runs,
      opts({ hiddenMetrics: new Set(['a']), chip: 'regressions' }),
    );
    expect(names(noA)).toEqual(['delta']);
    expect(noA.groups[0].metrics).toEqual(['b', 'eps']);

    const noG1 = tableModel(cmp, c, runs, opts({ hiddenGroups: new Set(['g1']) }));
    expect(noG1.counts.all).toBe(2);
    expect(names(noG1)).toEqual(['delta', 'ALPHA_three']);

    // Showing the hidden run r3 makes gamma a regression.
    const withR3 = tableModel(cmp, c, [r1, r2, run('r3')], opts({ chip: 'regressions' }));
    expect(names(withR3)).toEqual(['Alpha_one', 'gamma', 'delta']);
  });

  it('sorts within each group: config order, name, most regressions', () => {
    expect(names(tableModel(cmp, c, runs, opts({ sort: 'name' })))).toEqual([
      'Alpha_one',
      'beta_two',
      'gamma',
      'ALPHA_three',
      'delta',
    ]);
    expect(names(tableModel(cmp, c, runs, opts({ sort: 'regressions' })))).toEqual([
      'Alpha_one',
      'beta_two',
      'gamma',
      'delta',
      'ALPHA_three',
    ]);
  });
});

describe('markdownComparison', () => {
  const c = config();
  const cmp = comparison(c);
  const runs = visibleRuns([r1, r2, r3]);
  const hidden = new Set(['b']);
  const model = tableModel(cmp, c, runs, opts({ filter: 'alpha', hiddenMetrics: hidden }));

  it('visible: exactly the shown rows with the visible metrics', () => {
    const md = markdownComparison(cmp, c, model, hidden, { kind: 'visible' });
    expect(md.groups.map((g) => g.experiments.map((r) => r.name))).toEqual([
      ['Alpha_one'],
      ['ALPHA_three'],
    ]);
    expect(md.groups[0].group.metrics).toEqual(['a', 'eps']);
  });

  it('all and group scopes ignore the row filters but keep metric visibility', () => {
    const all = markdownComparison(cmp, c, model, hidden, { kind: 'all' });
    expect(all.groups.map((g) => g.experiments.length)).toEqual([3, 2, 0]);
    expect(all.groups.every((g) => !g.group.metrics.includes('b'))).toBe(true);
    const g2 = markdownComparison(cmp, c, model, hidden, { kind: 'group', name: 'g2' });
    expect(g2.groups.map((g) => g.group.name)).toEqual(['g2']);
    expect(c.groups[1].metrics).toEqual(['a', 'b', 'eps']); // the config is never mutated
  });

  it('feeds renderMarkdown with only the visible runs and metrics (fixtures)', () => {
    const cfg = v1SmallConfig();
    const base = smallBaseline();
    const r = smallRun();
    const full = compareAll(cfg, base, [r], {});
    const firstKey = cfg.groups[0].metrics[0];
    const hide = new Set([firstKey]);
    const m = tableModel(full, cfg, [r], opts({ hiddenMetrics: hide }));
    const restricted = markdownComparison(full, cfg, m, hide, { kind: 'visible' });
    const text = renderMarkdown(restricted, cfg, {
      baselineLabel: base.label,
      runLabels: [r.label],
      runIds: [r.id],
    });
    expect(text).toContain(`### ${cfg.groups[0].experiments[0]}`);
    expect(text.split('\n').some((l) => l.startsWith(`| ${firstKey} `))).toBe(false);
    expect(text.split('\n').filter((l) => l.startsWith('### ')).length).toBe(m.shown);
  });
});
