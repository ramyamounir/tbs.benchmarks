import type { MatchMode, ParsedCsv, Table } from '../model/types';
import { clipSubject, compileMatchRegex, escapeRegExp } from './safeRegex';

export type MatchHow = 'exact' | 'suffix' | 'regex' | 'none';
export interface FoundRows {
  indices: number[]; // ascending table row indices (file order); shared, never mutate
  how: MatchHow;
}

// One id index per parsed table and id column: every group × experiment × run × metric lookup
// reuses it, and a new load (new ParsedCsv) gets a new one.
const indexCache = new WeakMap<ParsedCsv, Map<string, Map<string, number[]>>>();
// Memo of findRows results per parsed table (the same lookups repeat for every metric, for the
// unassigned scan and while the config is edited). Bounded per table.
const resultCache = new WeakMap<ParsedCsv, Map<string, FoundRows>>();
const MAX_RESULTS_PER_TABLE = 20_000;

/** `trimmed id → ascending row indices` for `idColumn`; empty when the column is absent. */
export function idIndex(table: Table, idColumn: string): Map<string, number[]> {
  let byColumn = indexCache.get(table.csv);
  if (!byColumn) {
    byColumn = new Map();
    indexCache.set(table.csv, byColumn);
  }
  let index = byColumn.get(idColumn);
  if (index) return index;
  index = new Map();
  const c = table.csv.header.indexOf(idColumn);
  if (c >= 0) {
    const rows = table.csv.rows;
    for (let i = 0; i < rows.length; i++) {
      const key = (rows[i][c] ?? '').trim();
      const list = index.get(key);
      if (list) list.push(i);
      else index.set(key, [i]);
    }
  }
  byColumn.set(idColumn, index);
  return index;
}

function modeKey(mode: MatchMode): string {
  return typeof mode === 'string' ? mode : `regex:${mode.regex}`;
}

const NONE: FoundRows = { indices: [], how: 'none' };

/**
 * Every row of `table` whose id matches `name`: exact first (as v1); otherwise, by `mode`, the v1
 * run-id suffix rule `^name($|[_-/:.].+)` or the user regex (`{name}` replaced by the escaped
 * name). Ids and the name are compared trimmed. A rejected user regex matches nothing. Returns all matches so duplicates are visible;
 * never throws (a rejected user regex finds nothing).
 */
export function findRows(table: Table, idColumn: string, name: string, mode: MatchMode): FoundRows {
  let memo = resultCache.get(table.csv);
  if (!memo) {
    memo = new Map();
    resultCache.set(table.csv, memo);
  }
  const memoKey = `${idColumn}\u0000${modeKey(mode)}\u0000${name}`;
  const hit = memo.get(memoKey);
  if (hit) return hit;

  const result = findRowsUncached(table, idColumn, name.trim(), mode);
  if (memo.size >= MAX_RESULTS_PER_TABLE) memo.clear();
  memo.set(memoKey, result);
  return result;
}

function findRowsUncached(
  table: Table,
  idColumn: string,
  name: string,
  mode: MatchMode,
): FoundRows {
  // A rejected user regex finds nothing at all (not even exact matches), so the problem is visible
  // as missing cells instead of silently degrading to exact matching.
  const compiled = typeof mode === 'string' ? null : compileMatchRegex(mode.regex, name);
  if (compiled && 'error' in compiled) return NONE;
  const index = idIndex(table, idColumn);
  const exact = index.get(name);
  if (exact && exact.length > 0) return { indices: exact, how: 'exact' };
  if (mode === 'exact') return NONE;

  const matched: number[] = [];
  if (mode === 'suffix') {
    const re = new RegExp(`^${escapeRegExp(name)}(?:$|[_\\-/:.].+)`);
    for (const [key, rows] of index) {
      if (key.startsWith(name) && re.test(key)) for (const r of rows) matched.push(r);
    }
    if (matched.length === 0) return NONE;
    return { indices: matched.sort((a, b) => a - b), how: 'suffix' };
  }

  if (!compiled || 'error' in compiled) return NONE;
  for (const [key, rows] of index) {
    if (compiled.re.test(clipSubject(key))) for (const r of rows) matched.push(r);
  }
  if (matched.length === 0) return NONE;
  return { indices: matched.sort((a, b) => a - b), how: 'regex' };
}
