import type { SourceKind } from './types';

/**
 * File kind from the header row: a wandb export has `Name` plus `State` or `Runtime`; a benchmark
 * table (repo) has `Experiment`. Header names are compared after trimming surrounding spaces.
 */
export function detectKind(header: string[]): SourceKind | 'unknown' {
  const names = new Set(header.map((h) => h.trim()));
  if (names.has('Name') && (names.has('State') || names.has('Runtime'))) return 'wandb';
  if (names.has('Experiment')) return 'repo';
  return 'unknown';
}

// v1 `ID_CANDIDATES` (tbp.benchmarks compare.py), same order.
const ID_CANDIDATES = ['Experiment', 'Name', 'experiment', 'name', 'Experiment Name', 'run_name'];

/**
 * The id column of a table, as v1 `find_id_column`: exact candidates in order, then the same
 * candidates case-insensitively. `null` for an unknown kind or when no candidate exists.
 */
export function findIdColumn(header: string[], kind: SourceKind | 'unknown'): string | null {
  if (kind === 'unknown') return null;
  for (const c of ID_CANDIDATES) if (header.includes(c)) return c;
  const lower = new Map<string, string>();
  for (const h of header) if (!lower.has(h.toLowerCase())) lower.set(h.toLowerCase(), h);
  for (const c of ID_CANDIDATES) {
    const hit = lower.get(c.toLowerCase());
    if (hit !== undefined) return hit;
  }
  return null;
}

/**
 * Table key used by `Group.table`: `benchmarks/<name>.csv` for a file whose parent folder is
 * `benchmarks` (`tbp.monty/benchmarks/ycb_10objs.csv` → `benchmarks/ycb_10objs.csv`), the bare
 * `<name>.csv` otherwise.
 */
export function tablePath(file: string): string {
  const parts = file.replaceAll('\\', '/').split('/').filter(Boolean);
  const name = parts.at(-1) ?? '';
  return parts.length >= 2 && parts.at(-2) === 'benchmarks' ? `benchmarks/${name}` : name;
}
