import { describe, expect, it } from 'vitest';
import { smallBaseline, smallRun } from '../fixtures/files';
import type { MatchMode, Table } from '../model/types';
import { findRows, idIndex } from './match';
import { escapeRegExp } from './safeRegex';

/** Reference implementation: a naive scan of every row (v1 `find_row_by_name`, all matches). */
function naive(table: Table, idColumn: string, name: string, mode: MatchMode) {
  const c = table.csv.header.indexOf(idColumn);
  const ids = table.csv.rows.map((r) => (c < 0 ? undefined : (r[c] ?? '').trim()));
  const n = name.trim();
  const exact = ids.flatMap((id, i) => (id === n ? [i] : []));
  if (exact.length) return { indices: exact, how: 'exact' };
  if (mode === 'exact') return { indices: [], how: 'none' };
  const re =
    mode === 'suffix'
      ? new RegExp(`^${escapeRegExp(n)}(?:$|[_\\-/:.].+)`)
      : new RegExp(mode.regex.replaceAll('{name}', () => escapeRegExp(n)));
  const hits = ids.flatMap((id, i) => (id !== undefined && re.test(id) ? [i] : []));
  return hits.length
    ? { indices: hits, how: mode === 'suffix' ? 'suffix' : 'regex' }
    : { indices: [], how: 'none' };
}

const MODES: MatchMode[] = ['exact', 'suffix', { regex: '^{name}(_[a-z0-9]{8})?$' }];

describe('findRows', () => {
  const baseline = smallBaseline();
  const run = smallRun();
  const tables = [...baseline.tables, ...run.tables];
  const names = [
    ...new Set(tables.flatMap((t) => t.csv.rows.map((r) => r[0]))),
    'base_config_10distinctobj_surf_agent',
    'base_config_10distinctobj_dist_agent',
    'randrot_noise_sim_on_scan_monty_world',
    'world_image_on_scanned_model',
    'not_there',
  ];

  it('agrees with a naive per-row scan for every experiment and mode', () => {
    for (const t of tables) {
      const idColumn = t.idColumn!;
      for (const name of names) {
        for (const mode of MODES) {
          const got = findRows(t, idColumn, name, mode);
          expect(
            { indices: got.indices, how: got.how },
            `${t.path} ${name} ${JSON.stringify(mode)}`,
          ).toEqual(naive(t, idColumn, name, mode));
        }
      }
    }
  });

  it('finds duplicates with run-id suffixes in file order', () => {
    const t = run.tables[0];
    expect(findRows(t, 'Name', 'base_config_10distinctobj_surf_agent', 'suffix')).toEqual({
      indices: [1, 2],
      how: 'suffix',
    });
    expect(findRows(t, 'Name', 'base_config_10distinctobj_surf_agent', 'exact').how).toBe('none');
    // A suffix match must be followed by a delimiter: '..._agent_x' matches '..._agent' only.
    expect(findRows(t, 'Name', 'base_config_10distinctobj_surf', 'suffix').indices).toEqual([1, 2]);
    expect(findRows(t, 'Name', 'base_config_10distinctobj_surf_agen', 'suffix').how).toBe('none');
  });

  it('prefers exact matches', () => {
    const t = baseline.tables[0];
    expect(findRows(t, 'Experiment', ' base_config_10distinctobj_dist_agent ', 'suffix')).toEqual({
      indices: [0],
      how: 'exact',
    });
  });

  it('never throws for a rejected regex', () => {
    const t = run.tables[0];
    expect(findRows(t, 'Name', 'x', { regex: '[unclosed' })).toEqual({ indices: [], how: 'none' });
    expect(findRows(t, 'Name', 'x', { regex: '({name}+)+' })).toEqual({ indices: [], how: 'none' });
  });

  it('returns nothing for an absent id column', () => {
    expect(findRows(run.tables[0], 'Experiment', 'x', 'suffix').how).toBe('none');
    expect(idIndex(run.tables[0], 'Experiment').size).toBe(0);
  });

  it('builds one id index per table and column', () => {
    const t = run.tables[0];
    expect(idIndex(t, 'Name')).toBe(idIndex(t, 'Name'));
    expect(idIndex(t, 'Name').get('base_config_10distinctobj_dist_agent_k3b9xq2e')).toEqual([0]);
    // A new parse (new load) gets a new index.
    expect(idIndex(smallRun().tables[0], 'Name')).not.toBe(idIndex(t, 'Name'));
  });
});
