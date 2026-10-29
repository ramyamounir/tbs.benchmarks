import { describe, expect, it } from 'vitest';
import { builtinConfig } from '../config/builtin';
import { synthBaselineFiles, synthWandbCsv } from '../fixtures/synthWandb';
import { buildSource } from '../model/source';
import { compareAll } from './compare';

// Large-input budget (spec Phase 2b "Synthetic large export"): never skipped and never relaxed; if
// it fails, fix the engine.
describe('performance', () => {
  it('parses and compares a 64,000-row wandb export in < 3 s', { timeout: 30_000 }, () => {
    const text = synthWandbCsv(64_000);
    const files = synthBaselineFiles();

    const t0 = performance.now();
    const baseline = buildSource(files, { label: 'base', origin: 'local' }).source!;
    const run = buildSource([{ path: 'synth_64k.csv', text, lastModified: 0 }], {
      label: 'synth',
      origin: 'local',
    }).source!;
    const cmp = compareAll(builtinConfig, baseline, [run], {});
    const elapsed = performance.now() - t0;
    console.info(`perf: buildSource + compareAll on 64,000 rows took ${elapsed.toFixed(0)} ms`);

    expect(elapsed).toBeLessThan(3000);
    expect(run.tables[0].csv.rows.length).toBe(64_000);
    let checked = 0;
    for (const g of cmp.groups) {
      const k = g.group.metrics[0];
      for (const row of g.experiments) {
        expect(row.cells[run.id][k].match.candidates.length, row.name).toBeGreaterThan(1);
        checked++;
      }
    }
    expect(checked).toBe(38);
  });

  it('is deterministic', () => {
    expect(synthWandbCsv(50, 7)).toBe(synthWandbCsv(50, 7));
    expect(synthWandbCsv(50, 7)).not.toBe(synthWandbCsv(50, 8));
  });
});
