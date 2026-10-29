import { describe, expect, it } from 'vitest';
import { FOLDER_TOO_LARGE, groupFiles } from './files';
import {
  isConfigFileName,
  CSV_LIMITS,
  MAX_CONFIG_BYTES,
  MAX_CSV_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_WALK_DEPTH,
  MAX_WALK_ENTRIES,
  dirDepth,
  isIgnoredDirName,
  isIgnoredPath,
} from './limits';

const MB = 1024 * 1024;
const TABLES = [
  'base_results',
  'montymeetsworld',
  'ycb_10objs',
  'ycb_77objs',
  'ycb_unsupervised',
  'cows_a',
  'cows_b',
];

function monty(gitEntries: number): { path: string; size: number }[] {
  const out: { path: string; size: number }[] = [];
  for (let i = 0; i < gitEntries; i++) {
    out.push({ path: `tbp.monty/.git/objects/${(i % 256).toString(16)}/${i}abcdef`, size: 100 });
  }
  for (const t of TABLES) out.push({ path: `tbp.monty/benchmarks/${t}.csv`, size: 2_000 });
  for (let i = 0; i < 100; i++) out.push({ path: `tbp.monty/src/pkg${i % 5}/m${i}.py`, size: 500 });
  return out;
}

describe('limits', () => {
  it('exposes the constants', () => {
    expect(MAX_WALK_ENTRIES).toBe(20_000);
    expect(MAX_WALK_DEPTH).toBe(4);
    expect(MAX_CSV_FILES).toBe(200);
    expect(MAX_FILE_BYTES).toBe(50 * MB);
    expect(MAX_TOTAL_BYTES).toBe(300 * MB);
    expect(MAX_CONFIG_BYTES).toBe(1_000_000);
    expect(CSV_LIMITS).toBeDefined();
  });

  it('isIgnoredDirName / isIgnoredPath', () => {
    expect(isIgnoredDirName('.git')).toBe(true);
    expect(isIgnoredDirName('.github')).toBe(true);
    expect(isIgnoredDirName('.venv')).toBe(true);
    expect(isIgnoredDirName('node_modules')).toBe(true);
    expect(isIgnoredDirName('benchmarks')).toBe(false);
    expect(isIgnoredPath('tbp.monty/.git/objects/ab/cd')).toBe(true);
    expect(isIgnoredPath('node_modules/x/a.csv')).toBe(true);
    expect(isIgnoredPath('.venv/a.csv')).toBe(true);
    expect(isIgnoredPath('top/.hidden/a.csv')).toBe(true);
    // the last segment is a file name, never a directory
    expect(isIgnoredPath('top/.hidden.csv')).toBe(false);
    expect(isIgnoredPath('tbp.monty/benchmarks/x.csv')).toBe(false);
    expect(isIgnoredPath('/tbp.monty/benchmarks/x.csv')).toBe(false);
  });

  it('dirDepth', () => {
    expect(dirDepth('x.csv')).toBe(0);
    expect(dirDepth('top/x.csv')).toBe(0);
    expect(dirDepth('tbp.monty/benchmarks/x.csv')).toBe(1);
    expect(dirDepth('top/a/b/c/d/x.csv')).toBe(4);
    expect(dirDepth('top/a/b/c/d/e/x.csv')).toBe(5);
    expect(dirDepth('/top/a/x.csv')).toBe(1);
  });
});

describe('groupFiles', () => {
  it('(a) a tbp.monty clone yields its 7 benchmark tables and no error', () => {
    const { groups, errors } = groupFiles(monty(5_000));
    expect(errors).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('tbp.monty');
    expect(groups[0].folder).toBe(true);
    expect(groups[0].entries).toHaveLength(7);
    expect(groups[0].entries.every((e) => e.path.startsWith('tbp.monty/benchmarks/'))).toBe(true);
  });

  it('(b) 30,000 ignored .git entries do not count', () => {
    const { groups, errors } = groupFiles(monty(30_000));
    expect(errors).toEqual([]);
    expect(groups[0].entries).toHaveLength(7);
  });

  it('(c) more than 20,000 remaining entries fail the whole load', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ path: `big/d${i % 50}/f${i}.txt`, size: 1 }));
    const over = groupFiles(many(20_001));
    expect(over.groups).toEqual([]);
    expect(over.errors).toEqual([{ file: 'big', message: FOLDER_TOO_LARGE, reason: 'too-many' }]);
    expect(over.errors[0].message).toBe('Folder too large — drop the benchmarks folder instead');
    const at = groupFiles(many(20_000));
    expect(at.errors.some((e) => e.message === FOLDER_TOO_LARGE)).toBe(false);
  });

  it('(d) ignored folders and depth', () => {
    const { groups, errors } = groupFiles([
      { path: 'node_modules/x/a.csv', size: 1 },
      { path: '.venv/a.csv', size: 1 },
      { path: 'top/.hidden/a.csv', size: 1 },
      { path: 'top/a/b/c/d/x.csv', size: 1 },
      { path: 'top/a/b/c/d/e/x.csv', size: 1 },
    ]);
    expect(errors).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.path)).toEqual(['top/a/b/c/d/x.csv']);
  });

  it('(e) candidate selection', () => {
    const noBench = groupFiles([
      { path: 'top/a.csv', size: 1 },
      { path: 'top/sub/b.CSV', size: 1 },
      { path: 'top/readme.md', size: 1 },
    ]);
    expect(noBench.errors).toEqual([]);
    expect(noBench.groups[0].entries.map((e) => e.path)).toEqual(['top/a.csv', 'top/sub/b.CSV']);

    const bench = groupFiles([
      { path: 'top/benchmarks/x.csv', size: 1 },
      { path: 'top/other/x.csv', size: 1 },
      { path: 'top/benchmarks/notes.txt', size: 1 },
    ]);
    expect(bench.errors).toEqual([]);
    expect(bench.groups[0].entries.map((e) => e.path)).toEqual(['top/benchmarks/x.csv']);

    const loose = groupFiles([
      { path: 'notes.txt', size: 1 },
      { path: 'a.csv', size: 1 },
      { path: 'b.csv', size: 1 },
    ]);
    expect(loose.errors).toEqual([
      { file: 'notes.txt', message: 'Not a CSV file', reason: 'unsupported' },
    ]);
    // each loose CSV is its own group, labelled with its file name
    expect(loose.groups.map((g) => [g.label, g.folder, g.entries.length])).toEqual([
      ['a.csv', false, 1],
      ['b.csv', false, 1],
    ]);
  });

  it('(f) a candidate over 50 MB is skipped, the others kept', () => {
    const { groups, errors } = groupFiles([
      { path: 'top/benchmarks/a.csv', size: 51 * MB },
      { path: 'top/benchmarks/b.csv', size: 10 },
    ]);
    expect(errors).toEqual([
      { file: 'top/benchmarks/a.csv', message: 'File too large (> 50 MB)', reason: 'too-large' },
    ]);
    expect(groups[0].entries.map((e) => e.path)).toEqual(['top/benchmarks/b.csv']);
  });

  it('(g) 201 loose CSVs → the first 200 by path + one too-many', () => {
    const entries = Array.from({ length: 201 }, (_, i) => ({
      path: `f${String(i).padStart(3, '0')}.csv`,
      size: 1,
    })).reverse();
    const { groups, errors } = groupFiles(entries);
    expect(groups).toHaveLength(200);
    expect(groups.some((g) => g.label === 'f200.csv')).toBe(false);
    expect(errors).toEqual([
      { file: 'f200.csv', message: 'Too many CSV files (> 200); 1 not loaded', reason: 'too-many' },
    ]);
  });

  it('(h) the total-bytes cap keeps the first files up to 300 MB', () => {
    const entries = Array.from({ length: 7 }, (_, i) => ({
      path: `top/benchmarks/t${i}.csv`,
      size: 49 * MB,
    }));
    const { groups, errors } = groupFiles(entries);
    expect(groups[0].entries).toHaveLength(6);
    expect(errors).toEqual([
      {
        file: 'top/benchmarks/t6.csv',
        message: 'Files too large in total (> 300 MB); 1 not loaded',
        reason: 'too-large',
      },
    ]);
  });

  it('keeps entry indices pointing into the input', () => {
    const input = [
      { path: 'top/x.txt', size: 1 },
      { path: 'top/b.csv', size: 1 },
      { path: 'top/a.csv', size: 1 },
    ];
    const { groups } = groupFiles(input);
    for (const e of groups[0].entries) expect(input[e.index].path).toBe(e.path);
  });

  it('strips a leading slash from walker paths', () => {
    const { groups } = groupFiles([{ path: '/tbp.monty/benchmarks/a.csv', size: 1 }]);
    expect(groups[0].label).toBe('tbp.monty');
    expect(groups[0].entries[0].path).toBe('tbp.monty/benchmarks/a.csv');
  });
});

describe('isConfigFileName (Phase 4a drag-anywhere import)', () => {
  it('routes .yaml / .yml / .json (any case) to the config import, everything else to loadFiles', () => {
    for (const n of ['a.yaml', 'b.YML', 'configs_repo_wandb.yml', 'c.Json']) {
      expect(isConfigFileName(n)).toBe(true);
    }
    for (const n of ['a.csv', 'yaml', 'a.yaml.csv', 'notes.txt', 'json']) {
      expect(isConfigFileName(n)).toBe(false);
    }
  });
});
