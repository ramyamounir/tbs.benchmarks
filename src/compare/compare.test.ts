import { describe, expect, it } from 'vitest';
import { smallBaseline, smallRun } from '../fixtures/files';
import { v1SmallConfig } from '../fixtures/v1_small.config';
import { buildSource } from '../model/source';
import type { Config, Metric } from '../model/types';
import { compareAll, compareMetric, groupTable, rowChoiceKey, verdictOf } from './compare';

const A = 'base_config_10distinctobj_dist_agent';
const B = 'base_config_10distinctobj_surf_agent';
const C = 'randrot_noise_sim_on_scan_monty_world';

describe('compareAll on the v1_small fixtures', () => {
  const baseline = smallBaseline();
  const run = smallRun();
  const config = v1SmallConfig();
  const cmp = compareAll(config, baseline, [run], {});
  const rows = Object.fromEntries(cmp.groups.flatMap((g) => g.experiments.map((e) => [e.name, e])));

  it('produces exactly the v1 values and verdicts', () => {
    expect(
      cmp.groups.map((g) => [g.group.name, g.valid, g.experiments.map((e) => e.name)]),
    ).toEqual([
      ['ycb_10objs', true, [A, B]],
      ['montymeetsworld', true, [C]],
    ]);
    const pick = (name: string, k: string) => {
      const { base, value, delta, verdict } = rows[name].cells[run.id][k];
      return { base, value, delta, verdict };
    };
    expect(pick(A, 'percent_correct')).toEqual({
      base: 100,
      value: 100,
      delta: 0,
      verdict: 'same',
    });
    // NaN in the run → missing.
    expect(pick(A, 'rotation_error')).toEqual({
      base: 10.32,
      value: null,
      delta: null,
      verdict: 'missing',
    });
    expect(pick(B, 'percent_correct')).toEqual({
      base: 100,
      value: 90,
      delta: -10,
      verdict: 'worse',
    });
    expect(pick(B, 'rotation_error')).toMatchObject({ base: 3.64, value: 3.5, verdict: 'better' });
    // Group column override: the LM_2 column is read for the run.
    expect(pick(C, 'percent_correct')).toMatchObject({ base: 90, value: 93.33, verdict: 'better' });
    expect(rows[C].cells[run.id].rotation_error).toBeUndefined();
  });

  it('records how rows were found', () => {
    expect(rows[A].baseRow).toEqual({ how: 'exact', index: 0, candidates: [0], chosen: 0 });
    expect(rows[A].cells[run.id].percent_correct.match).toEqual({
      how: 'suffix',
      index: 0,
      candidates: [0],
      chosen: 0,
    });
    expect(rows[B].cells[run.id].percent_correct.match.candidates).toEqual([1, 2]);
  });

  it('computes coverage, counts, unassigned and missing', () => {
    expect(cmp.runs).toHaveLength(1);
    expect(cmp.runs[0].source).toBe(run);
    expect(cmp.runs[0].coverage).toEqual({ found: 3, total: 3, partial: false });
    expect(cmp.runs[0].counts).toEqual({ same: 1, better: 2, worse: 1, mismatch: 0, missing: 1 });
    expect(cmp.unassigned).toEqual([
      {
        table: 'benchmarks/ycb_10objs.csv',
        sourceId: baseline.id,
        names: ['randrot_noise_10distinctobj_dist_agent'],
      },
      {
        table: 'benchmarks/montymeetsworld.csv',
        sourceId: baseline.id,
        names: ['world_image_on_scanned_model'],
      },
      {
        table: 'wandb_small.csv',
        sourceId: run.id,
        names: ['dark_world_image_on_scanned_model_99l2zpjy'],
      },
    ]);
    expect(cmp.missing).toEqual([]);
    expect(Object.values(rows).every((r) => r.episodesMismatch[run.id] === false)).toBe(true);
  });

  it('lists config experiments with no baseline row', () => {
    const c = v1SmallConfig();
    c.groups[0].experiments.push('not_a_real_exp');
    const res = compareAll(c, baseline, [run], {});
    expect(res.missing).toEqual([{ group: 'ycb_10objs', names: ['not_a_real_exp'] }]);
    const row = res.groups[0].experiments.find((e) => e.name === 'not_a_real_exp')!;
    expect(row.baseRow.how).toBe('none');
    expect(row.cells[run.id].percent_correct.verdict).toBe('missing');
    expect(res.runs[0].coverage).toEqual({ found: 3, total: 4, partial: false });
  });

  it('honours row choices only while they are still candidates', () => {
    const key = rowChoiceKey(run.id, 'wandb_small.csv', B);
    expect(key).toBe(`${run.id}\u0000wandb_small.csv\u0000${B}`);
    const dflt = rows[B].cells[run.id].rotation_error;
    expect(dflt.match.chosen).toBe(dflt.match.candidates[0]);

    const picked = compareAll(config, baseline, [run], { [key]: dflt.match.candidates[1] });
    const cell = picked.groups[0].experiments[1].cells[run.id].rotation_error;
    expect(cell.match.chosen).toBe(dflt.match.candidates[1]);
    expect(cell.match.index).toBe(dflt.match.candidates[1]);
    expect(cell.value).toBe(4);
    expect(cell.verdict).toBe('worse');

    for (const bad of [-1, 0, 3, 99]) {
      const fallback = compareAll(config, baseline, [run], { [key]: bad });
      const c2 = fallback.groups[0].experiments[1].cells[run.id].rotation_error;
      expect(c2.match.chosen).toBe(dflt.match.candidates[0]);
      expect(c2.value).toBe(3.5);
    }
  });

  it('compareMetric equals the cells of compareAll for every metric', () => {
    for (const k of Object.keys(config.metrics)) {
      const one = compareMetric(config, k, baseline, [run], {});
      const expected: Record<string, unknown> = {};
      for (const g of cmp.groups) {
        for (const e of g.experiments) {
          if (e.cells[run.id][k]) expected[e.name] = e.cells[run.id][k];
        }
      }
      expect(one[run.id]).toEqual(expected);
    }
    expect(compareMetric(config, 'toString', baseline, [run], {})).toEqual({ [run.id]: {} });
  });

  it('never throws for rejected user regexes; affected cells are missing', () => {
    const c = v1SmallConfig();
    c.groups[1].match = { regex: '[unclosed' };
    c.metrics.rotation_error.columns.wandb!.transforms = [
      { kind: 'regex_replace', pattern: '(a+)+$', replacement: '' },
      { kind: 'to_number' },
    ];
    const res = compareAll(c, baseline, [run], {});
    const mmw = res.groups[1].experiments[0];
    expect(mmw.baseRow.how).toBe('none');
    expect(mmw.cells[run.id].percent_correct.verdict).toBe('missing');
    expect(mmw.cells[run.id].percent_correct.match.how).toBe('none');
    for (const e of res.groups[0].experiments) {
      expect(e.cells[run.id].rotation_error.verdict).toBe('missing');
      expect(e.cells[run.id].rotation_error.value).toBeNull();
    }
    expect(res.missing).toEqual([{ group: 'montymeetsworld', names: [C] }]);
    expect(() => compareMetric(c, 'percent_correct', baseline, [run], {})).not.toThrow();
  });

  it('skips group metric references that are not own keys', () => {
    const c = v1SmallConfig();
    c.groups[0].metrics = ['toString', 'percent_correct', 'constructor'];
    const res = compareAll(c, baseline, [run], {});
    expect(Object.keys(res.groups[0].experiments[0].cells[run.id])).toEqual(['percent_correct']);
  });

  it('marks a group invalid when the baseline lacks its table', () => {
    const c = v1SmallConfig();
    c.groups[0].table = 'benchmarks/logos_on_objects.csv';
    const res = compareAll(c, baseline, [run], {});
    expect(res.groups[0].valid).toBe(false);
    expect(res.groups[0].experiments.every((e) => e.baseRow.how === 'none')).toBe(true);
    expect(res.missing[0]).toEqual({ group: 'ycb_10objs', names: [A, B] });
  });

  it('flags episode mismatches for match-direction metrics', () => {
    const c: Config = v1SmallConfig();
    c.metrics.num_episodes = {
      label: 'Episodes',
      direction: 'match',
      tolerance: 0,
      tolerance_mode: 'absolute',
      decimals: 0,
      columns: {
        repo: { column: 'Num Episodes|hidden', transforms: [{ kind: 'to_number' }] },
        wandb: { column: 'overall/num_episodes', transforms: [{ kind: 'to_number' }] },
      },
    };
    c.groups[1].metrics.push('num_episodes');
    c.groups[0].metrics.push('num_episodes');
    // The ycb rows agree (140 vs 140); change the run's C row is 120 vs baseline 120 → same.
    const res = compareAll(c, baseline, [run], {});
    expect(res.groups[0].experiments[0].cells[run.id].num_episodes.verdict).toBe('same');
    const other = buildSource(
      [
        {
          path: 'r.csv',
          text: 'Name,State,overall/num_episodes\nrandrot_noise_sim_on_scan_monty_world_x,finished,100\n',
          lastModified: 0,
        },
      ],
      { label: 'r', origin: 'local' },
    ).source!;
    const res2 = compareAll(c, baseline, [other], {});
    const row = res2.groups[1].experiments[0];
    expect(row.cells[other.id].num_episodes.verdict).toBe('mismatch');
    expect(row.episodesMismatch[other.id]).toBe(true);
    expect(res2.runs[0].coverage).toEqual({ found: 1, total: 3, partial: true });
  });
});

describe('groupTable', () => {
  it('reads group.table for repo sources and the single export for wandb', () => {
    const baseline = smallBaseline();
    const run = smallRun();
    const g = v1SmallConfig().groups[1];
    expect(groupTable(g, baseline)?.path).toBe('benchmarks/montymeetsworld.csv');
    expect(groupTable(g, run)).toBe(run.tables[0]);
    expect(groupTable({ ...g, table: null }, baseline)).toBeNull();
    expect(groupTable({ ...g, table: null }, run)).toBe(run.tables[0]);
  });
});

describe('verdictOf', () => {
  const m = (over: Partial<Metric>): Metric => ({
    label: 'm',
    direction: 'higher',
    tolerance: 0.1,
    tolerance_mode: 'absolute',
    decimals: 2,
    columns: {},
    ...over,
  });
  it('applies tolerance, direction and percent mode', () => {
    expect(verdictOf(m({}), null, 1)).toBe('missing');
    expect(verdictOf(m({}), 1, null)).toBe('missing');
    expect(verdictOf(m({}), 1, 1.05)).toBe('same');
    expect(verdictOf(m({}), 1, 1)).toBe('same');
    expect(verdictOf(m({}), 1, 1.2)).toBe('better');
    expect(verdictOf(m({}), 1, 0.8)).toBe('worse');
    expect(verdictOf(m({ direction: 'lower' }), 1, 0.8)).toBe('better');
    expect(verdictOf(m({ direction: 'match', tolerance: 0 }), 140, 100)).toBe('mismatch');
    expect(verdictOf(m({ direction: 'match', tolerance: 0 }), 140, 140)).toBe('same');
    expect(verdictOf(m({ tolerance: 5, tolerance_mode: 'percent' }), -200, -191)).toBe('same');
    expect(verdictOf(m({ tolerance: 5, tolerance_mode: 'percent' }), -200, -189)).toBe('better');
  });
});
