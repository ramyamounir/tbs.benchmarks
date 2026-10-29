import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, isSafeEntryName, zipStore, type ZipEntry } from './zip';

/** Tiny independent-ish reader of the central directory (writer bugs could hide here too). */
function readCentral(buf: Uint8Array) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  let p = view.getUint32(eocd + 16, true);
  expect(p + cdSize).toBe(eocd);
  const dec = new TextDecoder();
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const csize = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const external = view.getUint32(p + 38, true);
    const offset = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    // Local header agrees with the central entry.
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint16(offset + 6, true) & 0x0800).toBe(0x0800);
    const localNameLen = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + localNameLen + localExtra;
    const data = buf.slice(dataStart, dataStart + csize);
    out.push({ name, flags, method, crc, csize, usize, extraLen, commentLen, external, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const enc = new TextEncoder();
const ENTRIES: ZipEntry[] = [
  {
    name: 'benchmarks/ycb_77objs.csv',
    data: enc.encode('Experiment,Correct (%)\r\nrandrot_naïve_µ,98.50\n'),
  },
  { name: 'a b/c.d', data: new Uint8Array([0, 255, 1, 254]) },
  { name: 'empty.txt', data: new Uint8Array(0) },
];

async function zipBytes(entries: ZipEntry[]): Promise<Uint8Array> {
  return new Uint8Array(await zipStore(entries).arrayBuffer());
}

describe('isSafeEntryName', () => {
  it('accepts plain relative ASCII paths', () => {
    for (const n of ['benchmarks/ycb_77objs.csv', 'chart-c1.png', 'a b/c.d']) {
      expect(isSafeEntryName(n), n).toBe(true);
    }
  });

  it('rejects traversal, absolute, drive, control and non-ASCII names', () => {
    for (const n of [
      '',
      '../x',
      'a/../b',
      './a',
      'a//b',
      'a/',
      '/etc/x',
      'C:\\x',
      'a\\b',
      'x\u0000y',
      'naïve.csv',
      'a'.repeat(201),
    ]) {
      expect(isSafeEntryName(n), JSON.stringify(n)).toBe(false);
    }
    expect(isSafeEntryName('a'.repeat(200))).toBe(true);
  });
});

describe('zipStore', () => {
  it('writes a valid STORE zip', async () => {
    const blob = zipStore(ENTRIES);
    expect(blob.type).toBe('application/zip');
    const entries = readCentral(new Uint8Array(await blob.arrayBuffer()));
    expect(entries.map((e) => e.name)).toEqual(ENTRIES.map((e) => e.name));
    entries.forEach((e, i) => {
      expect(e.method).toBe(0);
      expect(e.flags & 0x0800).toBe(0x0800);
      expect(e.external).toBe((0o100644 << 16) >>> 0);
      expect(e.csize).toBe(ENTRIES[i].data.length);
      expect(e.usize).toBe(ENTRIES[i].data.length);
      expect(e.crc).toBe(crc32(ENTRIES[i].data));
      expect(e.data).toEqual(ENTRIES[i].data);
    });
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('is deterministic', async () => {
    const two = ENTRIES.slice(0, 2);
    expect(await zipBytes(two)).toEqual(await zipBytes(two));
  });

  it('throws RangeError for unsafe or duplicate names and writes nothing', () => {
    const data = new Uint8Array([1]);
    expect(() => zipStore([{ name: '../x', data }])).toThrow(RangeError);
    expect(() => zipStore([{ name: '../x', data }])).toThrow('Unsafe zip entry name "../x"');
    expect(() =>
      zipStore([
        { name: 'a', data },
        { name: 'a', data },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      zipStore([
        { name: 'a', data },
        { name: 'a', data },
      ]),
    ).toThrow('Duplicate zip entry name "a"');
  });
});

// Independent extractor check (spec Phase 2a "Zip entry names").
const PY_VENV = '/home/ramy/tbp/tbp.benchmarks/.venv/bin/python';
function detectTool(): { kind: 'python'; exe: string } | { kind: 'unzip' } | null {
  if (existsSync(PY_VENV)) return { kind: 'python', exe: PY_VENV };
  const py = spawnSync('python3', ['-I', '-c', 'import zipfile'], { encoding: 'utf8' });
  if (!py.error && py.status === 0) return { kind: 'python', exe: 'python3' };
  const uz = spawnSync('unzip', ['-v'], { encoding: 'utf8' });
  if (!uz.error && uz.status === 0) return { kind: 'unzip' };
  return null;
}
const tool = detectTool();
const toolLabel =
  tool === null ? 'none' : tool.kind === 'python' ? `python (${tool.exe})` : 'unzip';
const PY_CHECK =
  "import zipfile,sys,json,base64; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({'names': z.namelist(), 'data': {n: base64.b64encode(z.read(n)).decode() for n in z.namelist()}}))";

describe('independent extractor', () => {
  it.skipIf(tool === null)(`extracts with ${toolLabel}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tbs-zip-'));
    try {
      const file = join(dir, 'test.zip');
      writeFileSync(file, await zipBytes(ENTRIES));
      if (tool!.kind === 'python') {
        const r = spawnSync(tool!.exe, ['-I', '-c', PY_CHECK, file], { encoding: 'utf8' });
        expect(r.status, r.stderr).toBe(0);
        const out = JSON.parse(r.stdout) as { names: string[]; data: Record<string, string> };
        expect(out.names).toEqual(ENTRIES.map((e) => e.name));
        for (const e of ENTRIES) {
          expect(new Uint8Array(Buffer.from(out.data[e.name], 'base64'))).toEqual(e.data);
        }
      } else {
        expect(spawnSync('unzip', ['-tq', file]).status).toBe(0);
        const list = spawnSync('unzip', ['-Z1', file], { encoding: 'utf8' });
        expect(list.stdout.split('\n').filter(Boolean)).toEqual(ENTRIES.map((e) => e.name));
        for (const e of ENTRIES) {
          const r = spawnSync('unzip', ['-p', file, e.name]);
          expect(new Uint8Array(r.stdout)).toEqual(e.data);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
