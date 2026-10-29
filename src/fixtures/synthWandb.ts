import { builtinConfig } from '../config/builtin';
import { parseCsv } from '../csv/parse';
import { REPO_HEADERS, WANDB_PR_1184_HEADER } from './headers';

/**
 * Deterministic synthetic inputs for the large-input performance test (spec Phase 2b "Synthetic
 * large export"): there is no large local fixture, so a wandb export of any size is generated here.
 */

/** mulberry32: a tiny, fast, seeded 32-bit PRNG (deterministic; no Math.random). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Every experiment of the built-in config, in config order (38 names). */
function experiments(): string[] {
  return builtinConfig.groups.flatMap((g) => g.experiments);
}

/**
 * A wandb export with the real `pr_1184.csv` header and `rows` data rows. Row `i` is a run of
 * experiment `i % 38` with an 8-character run-id suffix (so it matches through the `suffix` rule),
 * `Runtime` an integer 60–5000, `State` = finished, empty Tags/Notes, and decimals 0–100 elsewhere.
 */
export function synthWandbCsv(rows: number, seed = 1): string {
  const rand = mulberry32(seed);
  const header = parseCsv(WANDB_PR_1184_HEADER).header;
  const E = experiments();
  const lines: string[] = [WANDB_PR_1184_HEADER];
  for (let i = 0; i < rows; i++) {
    let s = '';
    for (let k = 0; k < 8; k++) s += BASE36[Math.floor(rand() * 36)];
    const fields = header.map((name) => {
      switch (name) {
        case 'Name':
          return `${E[i % E.length]}_${s}`;
        case 'Runtime':
          return String(60 + Math.floor(rand() * 4941));
        case 'State':
          return 'finished';
        case 'Tags':
        case 'Notes':
          return '';
        default:
          return String(Math.round(rand() * 100 * 1e6) / 1e6);
      }
    });
    lines.push(fields.join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * The 7 synthetic baseline tables: the real header of each table plus one row per experiment of
 * its built-in group (`Experiment` = the name, '1' in every other column).
 */
export function synthBaselineFiles(): { path: string; text: string; lastModified: number }[] {
  return builtinConfig.groups.map((g) => {
    const tablePath = g.table as string;
    const header = REPO_HEADERS[tablePath];
    const n = parseCsv(header).header.length;
    const rows = g.experiments.map((name) => [name, ...Array<string>(n - 1).fill('1')].join(','));
    return {
      path: `tbp.monty/${tablePath}`,
      text: [header, ...rows].join('\n') + '\n',
      lastModified: 0,
    };
  });
}
