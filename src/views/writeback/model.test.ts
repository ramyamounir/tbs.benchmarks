import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compareAll } from '../../compare/compare';
import { smallBaseline, smallRun } from '../../fixtures/files';
import { v1SmallConfig } from '../../fixtures/v1_small.config';
import { buildSource } from '../../model/source';
import { planWriteback } from '../../writeback/plan';

const downloads: { name: string; blob: Blob }[] = [];
vi.mock('../../util/download', async (orig) => ({
  ...(await orig<typeof import('../../util/download')>()),
  downloadBlob: (name: string, blob: Blob) => downloads.push({ name, blob }),
}));

const { downloadWritebackZip, downloadTableFile, rewrittenText, zipBlocker, zipTables } =
  await import('./model');

/** Entry names and texts of a STORE zip, read from its local headers. */
async function unzipNames(blob: Blob): Promise<{ name: string; text: string }[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  const out: { name: string; text: string }[] = [];
  let p = 0;
  while (p + 4 <= buf.length && view.getUint32(p, true) === 0x04034b50) {
    const size = view.getUint32(p + 18, true);
    const nameLen = view.getUint16(p + 26, true);
    const extraLen = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(buf.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extraLen;
    out.push({ name, text: new TextDecoder().decode(buf.subarray(start, start + size)) });
    p = start + size;
  }
  return out;
}

function model() {
  const config = v1SmallConfig();
  const baseline = smallBaseline();
  const run = smallRun('pr_1184.csv');
  const cmp = compareAll(config, baseline, [run], {});
  const plan = planWriteback(cmp, config, baseline, run, {
    keepFormatting: true,
    skipWithinTol: false,
    skipEpisodeMismatch: false,
    kept: new Set(),
  });
  return { baseline, run, plan };
}

beforeEach(() => {
  downloads.length = 0;
});

describe('write-back downloads', () => {
  it('the zip holds only the changed benchmarks/*.csv tables at their repo paths', async () => {
    const m = model();
    expect(downloadWritebackZip(m, {})).toBeNull();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toMatch(/^benchmarks-writeback-pr_1184.csv-\d{4}-\d{2}-\d{2}\.zip$/);
    const entries = await unzipNames(downloads[0].blob);
    expect(entries.map((e) => e.name).sort()).toEqual([
      'benchmarks/montymeetsworld.csv',
      'benchmarks/ycb_10objs.csv',
    ]);
    for (const e of entries) {
      expect(e.name).toMatch(/^benchmarks\/[^/]+\.csv$/);
      expect(e.text).toBe(rewrittenText(m.plan.tables.find((t) => t.path === e.name)!));
    }
  });

  it('a disabled file is left out; nothing enabled blocks the zip', () => {
    const m = model();
    expect(zipTables(m.plan, { 'benchmarks/ycb_10objs.csv': false }).map((t) => t.path)).toEqual([
      'benchmarks/montymeetsworld.csv',
    ]);
    const none = { 'benchmarks/ycb_10objs.csv': false, 'benchmarks/montymeetsworld.csv': false };
    expect(zipBlocker(m, none)).toBe('No file with changes is selected');
    expect(downloadWritebackZip(m, none)).not.toBeNull();
    expect(downloads).toHaveLength(0);
  });

  it('a table whose path cannot be zipped is excluded but still downloads alone', () => {
    const m = model();
    const tp = m.plan.tables[0];
    const odd = { ...tp, path: 'naïve (1).csv' };
    m.plan.tables = [odd];
    expect(zipTables(m.plan, {})).toEqual([]);
    downloadTableFile(odd);
    expect(downloads[0].name).toBe('na_ve_1_.csv');
    expect(downloads[0].blob.type).toBe('text/csv;charset=utf-8');
  });

  it('a non-repo baseline cannot produce a zip', () => {
    const m = model();
    const wandbBase = buildSource(
      [{ path: 'b.csv', text: 'Name,State\nx,finished\n', lastModified: 0 }],
      { label: 'b', origin: 'local' },
    ).source!;
    expect(zipBlocker({ ...m, baseline: wandbBase }, {})).toMatch(/not a benchmarks folder/);
  });
});
