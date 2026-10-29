/**
 * Writes the synthetic 64,000-row wandb export (spec Phase 7 "Performance pass") for a manual
 * large-input check in `npm run preview`; run with
 *
 *   npx tsx scripts/write_synth_wandb.ts
 *
 * The file goes to a fresh temp directory (never inside the repo) and its absolute path is
 * printed. Never bundled.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { synthWandbCsv } from '../src/fixtures/synthWandb';

const ROWS = 64_000;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbp-synth-'));
const file = path.join(dir, 'synth_64k.csv');
fs.writeFileSync(file, synthWandbCsv(ROWS));
console.log(file);
