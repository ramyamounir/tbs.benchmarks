// Node-only helpers for tests (never imported by app code): read the committed fixtures and build
// the baseline/run sources exactly as spec Phase 2a "v1 fixture capture" rule (3) prescribes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSource } from '../model/source';
import type { Source } from '../model/types';

export const FIXTURE_CSVS = [
  'repo_ycb_small.csv',
  'repo_mmw_small.csv',
  'wandb_small.csv',
] as const;

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./${name}`, import.meta.url));
}

export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf8');
}

/** Baseline with table paths `benchmarks/ycb_10objs.csv` and `benchmarks/montymeetsworld.csv`. */
export function smallBaseline(): Source {
  const { source } = buildSource(
    [
      {
        path: 'benchmarks/ycb_10objs.csv',
        text: readFixture('repo_ycb_small.csv'),
        lastModified: 0,
      },
      {
        path: 'benchmarks/montymeetsworld.csv',
        text: readFixture('repo_mmw_small.csv'),
        lastModified: 0,
      },
    ],
    { label: 'Baseline', origin: 'local' },
  );
  if (!source) throw new Error('fixture baseline did not build');
  return source;
}

/** The wandb run built from `wandb_small.csv`. */
export function smallRun(label = 'Proposed'): Source {
  const { source } = buildSource(
    [{ path: 'wandb_small.csv', text: readFixture('wandb_small.csv'), lastModified: 0 }],
    { label, origin: 'local' },
  );
  if (!source) throw new Error('fixture run did not build');
  return source;
}
