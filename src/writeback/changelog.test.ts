import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv/parse';
import { formatChangelog } from './changelog';
import type { WritebackEntry, WritebackPlan, WritebackSkip, WritebackTablePlan } from './plan';

const csv = parseCsv('Experiment,x\na,1\n');

function table(path: string, entries: Partial<WritebackEntry>[]): WritebackTablePlan {
  return {
    path,
    table: { path, kind: 'repo', idColumn: 'Experiment', csv },
    entries: entries.map((e) => ({
      rowIndex: 0,
      columnIndex: 1,
      column: 'Num Match Steps|align right',
      old: '31',
      new: '30',
      experiment: 'base_77obj_dist_agent',
      metric: 'match_steps',
      ...e,
    })),
    experiments: 1,
    notInRun: [],
    unwritable: [],
  };
}

const plan = (tables: WritebackTablePlan[]): WritebackPlan => ({ runId: 'r', tables });

describe('formatChangelog', () => {
  it('(a) renders one change', () => {
    expect(formatChangelog(plan([table('benchmarks/ycb_77objs.csv', [{}])]))).toBe(
      '=== Modify: benchmarks/ycb_77objs.csv ===\nbase_77obj_dist_agent | Num Match Steps|align right | 31 → 30\n',
    );
  });

  it('(b) renders each skip reason', () => {
    const reasons: WritebackSkip[] = ['tolerance', 'episodes', 'kept', 'non-numeric', 'transform'];
    const text = formatChangelog(
      plan([
        table(
          't.csv',
          reasons.map((skipped) => ({ skipped, new: '31' })),
        ),
      ]),
    );
    const lines = text.trimEnd().split('\n').slice(1);
    expect(lines).toEqual(
      reasons.map(
        (r) => `base_77obj_dist_agent | Num Match Steps|align right | 31 · skipped (${r})`,
      ),
    );
  });

  it('(c) separates tables by one blank line and omits empty tables', () => {
    const text = formatChangelog(
      plan([
        table('a.csv', [{}]),
        table('empty.csv', []),
        table('b.csv', [{ old: '1', new: '2' }]),
      ]),
    );
    expect(text).toBe(
      '=== Modify: a.csv ===\nbase_77obj_dist_agent | Num Match Steps|align right | 31 → 30\n' +
        '\n' +
        '=== Modify: b.csv ===\nbase_77obj_dist_agent | Num Match Steps|align right | 1 → 2\n',
    );
    expect(text).not.toContain('empty.csv');
  });

  it('(d) an empty plan gives an empty string', () => {
    expect(formatChangelog(plan([]))).toBe('');
    expect(formatChangelog(plan([table('a.csv', [])]))).toBe('');
  });

  it('(e) never uses the v1 ASCII arrow', () => {
    expect(formatChangelog(plan([table('a.csv', [{}, { skipped: 'kept' }])]))).not.toContain(
      ' -> ',
    );
  });

  it('(f) keeps every entry on one line and strips bidi controls', () => {
    const text = formatChangelog(
      plan([table('a.csv', [{ experiment: 'a\nb‮', column: 'c', old: '1\r\n2', new: '3' }])]),
    );
    expect(text.split('\n')[1] + '\n').toBe('a b | c | 1 2 → 3\n');
    expect(text).not.toContain('‮');
  });
});
