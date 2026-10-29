import { describe, expect, it } from 'vitest';
import { readFixture, smallBaseline, smallRun } from '../fixtures/files';
import { buildSource } from './source';

describe('buildSource', () => {
  it('builds the repo baseline from the committed fixtures', () => {
    const { source, errors } = buildSource(
      [
        {
          path: 'tbp.monty/benchmarks/ycb_10objs.csv',
          text: readFixture('repo_ycb_small.csv'),
          lastModified: 5,
        },
        {
          path: 'tbp.monty/benchmarks/montymeetsworld.csv',
          text: readFixture('repo_mmw_small.csv'),
          lastModified: 9,
        },
      ],
      { label: 'tbp.monty', origin: 'local' },
    );
    expect(errors).toEqual([]);
    expect(source).not.toBeNull();
    expect(source!.kind).toBe('repo');
    expect(source!.label).toBe('tbp.monty');
    expect(source!.origin).toBe('local');
    expect(source!.hidden).toBe(false);
    expect(source!.date).toBe(9);
    expect(source!.id).toMatch(/^[0-9a-f]{12}$/);
    expect(source!.tables.map((t) => t.path)).toEqual([
      'benchmarks/ycb_10objs.csv',
      'benchmarks/montymeetsworld.csv',
    ]);
    expect(source!.tables.map((t) => t.idColumn)).toEqual(['Experiment', 'Experiment']);
    expect(source!.tables[0].csv.rows).toHaveLength(3);
    expect(source!.meta).toBeUndefined();
  });

  it('builds the wandb run and gives every source a new id', () => {
    const run = smallRun();
    expect(run.kind).toBe('wandb');
    expect(run.tables).toHaveLength(1);
    expect(run.tables[0].path).toBe('wandb_small.csv');
    expect(run.tables[0].idColumn).toBe('Name');
    expect(run.tables[0].csv.rows).toHaveLength(5);
    expect(smallBaseline().id).not.toBe(smallBaseline().id);
  });

  it('uses the commit date for GitHub sources', () => {
    const meta = { owner: 'o', repo: 'r', ref: 'main', sha: 'abc', date: '2026-10-01T12:00:00Z' };
    const { source } = buildSource(
      [{ path: 'benchmarks/x.csv', text: 'Experiment,a\ne,1\n', lastModified: 0 }],
      { label: 'r@main', origin: 'github', meta },
    );
    expect(source!.date).toBe(Date.parse(meta.date));
    expect(source!.meta).toEqual(meta);
    const bad = buildSource(
      [{ path: 'benchmarks/x.csv', text: 'Experiment,a\ne,1\n', lastModified: 0 }],
      { label: 'r@main', origin: 'github', meta: { ...meta, date: 'nope' } },
    );
    expect(bad.source!.date).toBeNull();
  });

  it('reports undetected files and skips them', () => {
    const { source, errors } = buildSource(
      [
        { path: 'notes.csv', text: 'foo,bar\n1,2\n', lastModified: 0 },
        { path: 'empty.csv', text: '', lastModified: 0 },
      ],
      { label: 'x', origin: 'local' },
    );
    expect(source).toBeNull();
    expect(errors.map((e) => [e.file, e.reason])).toEqual([
      ['notes.csv', 'undetected'],
      ['empty.csv', 'undetected'],
    ]);
  });

  it('keeps the majority kind of a mixed source', () => {
    const { source, errors } = buildSource(
      [
        { path: 'run.csv', text: readFixture('wandb_small.csv'), lastModified: 0 },
        { path: 'benchmarks/a.csv', text: 'Experiment,x\ne,1\n', lastModified: 0 },
        { path: 'benchmarks/b.csv', text: 'Experiment,x\ne,1\n', lastModified: 0 },
      ],
      { label: 'mixed', origin: 'local' },
    );
    expect(source!.kind).toBe('repo');
    expect(source!.tables.map((t) => t.path)).toEqual(['benchmarks/a.csv', 'benchmarks/b.csv']);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe('run.csv');
    expect(errors[0].reason).toBe('undetected');
    expect(errors[0].message).toMatch(/mixed kinds/i);
  });

  it('turns a parser cap into a too-large LoadError without throwing', () => {
    const wide = Array.from({ length: 2_001 }, (_, i) => (i === 0 ? 'Experiment' : `c${i}`)).join(
      ',',
    );
    const { source, errors } = buildSource(
      [
        { path: 'benchmarks/wide.csv', text: wide + '\n', lastModified: 0 },
        {
          path: 'benchmarks/ycb_10objs.csv',
          text: readFixture('repo_ycb_small.csv'),
          lastModified: 0,
        },
      ],
      { label: 'b', origin: 'local' },
    );
    expect(source!.tables.map((t) => t.path)).toEqual(['benchmarks/ycb_10objs.csv']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: 'benchmarks/wide.csv', reason: 'too-large' });
    expect(errors[0].message).toMatch(/Too many columns/);
  });
});
