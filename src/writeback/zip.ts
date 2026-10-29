import { MIME } from '../util/download';

/**
 * Minimal STORE-method (uncompressed) zip writer: local headers, central directory, CRC-32. No
 * dependency. Entry names come from untrusted strings (table paths from folder/file names or a
 * GitHub listing, chart ids from imported configs) and the write-back zip is meant to be extracted
 * at the user's clone root, so the writer itself is the boundary: every name is validated before
 * any byte is written (spec Phase 2a "Zip entry names").
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const SAFE_NAME = /^[A-Za-z0-9._ -]+(\/[A-Za-z0-9._ -]+)*$/;
const MAX_NAME_BYTES = 200;

/** Relative, ASCII, no empty / `.` / `..` segment, no `\`, `:` or drive letter, ≤ 200 bytes. */
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0) return false;
  if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) return false;
  if (!SAFE_NAME.test(name)) return false;
  return name.split('/').every((s) => s !== '.' && s !== '..');
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const FLAG_UTF8 = 0x0800;
const VERSION = 20; // 2.0
const VERSION_MADE_BY = (3 << 8) | VERSION; // Unix
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0; // regular file, rw-r--r--
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01: fixed so the output is deterministic
const MAX_U32 = 0xffffffff;

/** A zip (STORE, no ZIP64) of `entries`. Throws RangeError for an unsafe or duplicate name. */
export function zipStore(entries: ZipEntry[]): Blob {
  const seen = new Set<string>();
  for (const e of entries) {
    if (!isSafeEntryName(e.name)) throw new RangeError(`Unsafe zip entry name "${e.name}"`);
    if (seen.has(e.name)) throw new RangeError(`Duplicate zip entry name "${e.name}"`);
    seen.add(e.name);
  }
  if (entries.length > 0xffff) throw new RangeError('Zip too large');

  const enc = new TextEncoder();
  const items = entries.map((e) => ({
    name: enc.encode(e.name),
    data: e.data,
    crc: crc32(e.data),
  }));
  let localSize = 0;
  let centralSize = 0;
  for (const it of items) {
    if (it.data.length > MAX_U32) throw new RangeError('Zip too large');
    localSize += 30 + it.name.length + it.data.length;
    centralSize += 46 + it.name.length;
  }
  const total = localSize + centralSize + 22;
  if (localSize > MAX_U32 || centralSize > MAX_U32 || total > MAX_U32) {
    throw new RangeError('Zip too large');
  }

  const buf = new Uint8Array(new ArrayBuffer(total));
  const view = new DataView(buf.buffer);
  let p = 0;
  const u16 = (v: number) => {
    view.setUint16(p, v, true);
    p += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(p, v >>> 0, true);
    p += 4;
  };
  const bytes = (b: Uint8Array) => {
    buf.set(b, p);
    p += b.length;
  };

  const offsets: number[] = [];
  for (const it of items) {
    offsets.push(p);
    u32(0x04034b50);
    u16(VERSION);
    u16(FLAG_UTF8);
    u16(0); // method: STORE
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(it.crc);
    u32(it.data.length); // compressed size
    u32(it.data.length); // uncompressed size
    u16(it.name.length);
    u16(0); // extra length
    bytes(it.name);
    bytes(it.data);
  }
  const centralStart = p;
  items.forEach((it, i) => {
    u32(0x02014b50);
    u16(VERSION_MADE_BY);
    u16(VERSION);
    u16(FLAG_UTF8);
    u16(0);
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(it.crc);
    u32(it.data.length);
    u32(it.data.length);
    u16(it.name.length);
    u16(0); // extra length
    u16(0); // comment length
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(EXTERNAL_ATTRS);
    u32(offsets[i]);
    bytes(it.name);
  });
  const centralLen = p - centralStart;
  u32(0x06054b50);
  u16(0); // this disk
  u16(0); // disk with the central directory
  u16(items.length);
  u16(items.length);
  u32(centralLen);
  u32(centralStart);
  u16(0); // comment length

  return new Blob([buf], { type: MIME.zip });
}
