import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_HEADERS, WANDB_PR_1184_HEADER } from './headers';

const MONTY = '/home/ramy/tbp/tbp.monty';
const PR_1184 = '/home/ramy/tbp/tbp.benchmarks/wandb_files/pr_1184.csv';

function firstLine(path: string): string {
  const text = readFileSync(path, 'utf8');
  const end = text.indexOf('\n');
  return (end < 0 ? text : text.slice(0, end)).replace(/\r$/, '');
}

describe('fixture headers', () => {
  it('lists the 7 benchmark tables', () => {
    expect(Object.keys(REPO_HEADERS)).toHaveLength(7);
  });

  for (const tablePath of Object.keys(REPO_HEADERS)) {
    const file = `${MONTY}/${tablePath}`;
    it.skipIf(!existsSync(file))(`${tablePath} equals the local file's first line`, () => {
      expect(REPO_HEADERS[tablePath]).toBe(firstLine(file));
    });
  }

  it.skipIf(!existsSync(PR_1184))('pr_1184.csv header equals the local file', () => {
    expect(WANDB_PR_1184_HEADER).toBe(firstLine(PR_1184));
  });
});
