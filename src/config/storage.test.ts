import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v1SmallConfig } from '../fixtures/v1_small.config';
import type { Config, SavedConfig } from '../model/types';
import {
  capSaved,
  CORRUPT_KEY,
  MAX_SAVED,
  newSavedId,
  readSaved,
  SAVED_ID_RE,
  type SavedState,
  STORAGE_KEY,
  storageBytes,
  writeSaved,
} from './storage';

/** In-memory Storage; `failWith` makes every setItem throw that error. */
class MemoryStorage implements Storage {
  map = new Map<string, string>();
  failWith: unknown = null;
  failGet = false;
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    if (this.failGet) throw new Error('denied');
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failWith) throw this.failWith;
    this.map.set(key, String(value));
  }
}

const entry = (id: string, updatedAt = 1, config: Config = v1SmallConfig()): SavedConfig => ({
  id,
  name: `cfg ${id}`,
  updatedAt,
  config,
});
const store = (st: MemoryStorage, value: unknown) =>
  st.map.set(STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value));
const envelope = (configs: unknown[], activeId: unknown = null) => ({
  version: 1,
  activeId,
  configs,
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('readSaved / writeSaved', () => {
  it('round-trips', () => {
    const st = new MemoryStorage();
    const state: SavedState = { activeId: 'b', configs: [entry('a'), entry('b', 2)] };
    expect(writeSaved(state, st)).toEqual({ ok: true });
    expect(readSaved(st)).toEqual(state);
    expect(st.map.has(CORRUPT_KEY)).toBe(false);
  });

  it('missing key → empty, no backup', () => {
    const st = new MemoryStorage();
    expect(readSaved(st)).toEqual({ activeId: null, configs: [] });
    expect(st.map.size).toBe(0);
  });

  it('corrupt JSON → empty and a one-time backup', () => {
    const st = new MemoryStorage();
    store(st, '{"version":1,');
    expect(readSaved(st)).toEqual({ activeId: null, configs: [] });
    expect(st.map.get(CORRUPT_KEY)).toBe('{"version":1,');
    store(st, 'garbage');
    readSaved(st);
    expect(st.map.get(CORRUPT_KEY)).toBe('{"version":1,');
    expect(st.map.get(STORAGE_KEY)).toBe('garbage'); // readSaved never writes the main key
  });

  it('bad envelopes → empty and backup', () => {
    for (const v of [{ version: 2, configs: [] }, { version: 1, configs: {} }, [], 'x']) {
      const st = new MemoryStorage();
      store(st, v);
      expect(readSaved(st)).toEqual({ activeId: null, configs: [] });
      expect(st.map.has(CORRUPT_KEY)).toBe(true);
    }
  });

  it('keeps the first of duplicate ids', () => {
    const st = new MemoryStorage();
    store(st, envelope([entry('a', 1), { ...entry('a', 2), name: 'second' }]));
    const r = readSaved(st);
    expect(r.configs.map((c) => c.name)).toEqual(['cfg a']);
    expect(st.map.has(CORRUPT_KEY)).toBe(true);
  });

  it('drops invalid ids and timestamps', () => {
    const st = new MemoryStorage();
    const bad = [
      { ...entry('x'), id: '' },
      { ...entry('x'), id: 'a/b' },
      { ...entry('x'), id: 'a'.repeat(65) },
      { ...entry('x'), id: 7 },
      { ...entry('n1'), updatedAt: NaN }, // JSON writes null
      { ...entry('n2'), updatedAt: -1 },
      { ...entry('n3'), updatedAt: '1' },
      'not an object',
    ];
    store(st, envelope([...bad, entry('ok')]));
    expect(readSaved(st).configs.map((c) => c.id)).toEqual(['ok']);
  });

  it('truncates long names', () => {
    const st = new MemoryStorage();
    store(st, envelope([{ ...entry('a'), name: 'n'.repeat(10_000) }]));
    expect(readSaved(st).configs[0].name).toHaveLength(120);
  });

  it('drops configs with errors, keeps configs with warnings', () => {
    const st = new MemoryStorage();
    const broken = v1SmallConfig() as unknown as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    broken.metrics.percent_correct.decimals = 1000;
    const typo = v1SmallConfig() as unknown as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    typo.metrics.percent_correct.tolerence = 1;
    store(
      st,
      envelope([
        entry('bad', 1, broken as unknown as Config),
        entry('warn', 1, typo as unknown as Config),
      ]),
    );
    const r = readSaved(st);
    expect(r.configs.map((c) => c.id)).toEqual(['warn']);
    expect(r.configs[0].config).toEqual(v1SmallConfig());
    expect(r.activeId).toBe('warn');
  });

  it('keeps at most 50 entries', () => {
    const st = new MemoryStorage();
    const list = Array.from({ length: 60 }, (_, i) => entry(`id${i}`));
    store(st, envelope(list, 'id55'));
    const r = readSaved(st);
    expect(r.configs).toHaveLength(MAX_SAVED);
    expect(r.configs.at(-1)?.id).toBe('id49');
    expect(r.activeId).toBe('id0');
  });

  it('falls back for an unknown activeId', () => {
    for (const activeId of ['zzz', 3]) {
      const st = new MemoryStorage();
      store(st, envelope([entry('a'), entry('b')], activeId));
      expect(readSaved(st).activeId).toBe('a');
    }
    const st = new MemoryStorage();
    store(st, envelope([{ id: 1 }], 'a'));
    expect(readSaved(st)).toEqual({ activeId: null, configs: [] });
  });

  it('survives unusable storage', () => {
    const st = new MemoryStorage();
    st.failGet = true;
    expect(readSaved(st)).toEqual({ activeId: null, configs: [] });

    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      expect(readSaved()).toEqual({ activeId: null, configs: [] });
      expect(writeSaved({ activeId: null, configs: [] })).toEqual({
        ok: false,
        reason: 'unavailable',
      });
    } finally {
      if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('refuses an oversized config without writing', () => {
    const st = new MemoryStorage();
    writeSaved({ activeId: 'a', configs: [entry('a')] }, st);
    const before = st.map.get(STORAGE_KEY);
    const big = v1SmallConfig();
    big.groups[0].experiments = Array.from({ length: 1200 }, (_, i) => `${i}`.padEnd(500, 'x'));
    expect(JSON.stringify(big).length).toBeGreaterThan(600_000);
    expect(writeSaved({ activeId: 'a', configs: [entry('a'), entry('big', 1, big)] }, st)).toEqual({
      ok: false,
      reason: 'too-large',
      id: 'big',
    });
    expect(st.map.get(STORAGE_KEY)).toBe(before);
  });

  it('refuses a payload over 4 Mi characters', () => {
    const st = new MemoryStorage();
    const configs = Array.from({ length: 9 }, (_, n) => {
      const c = v1SmallConfig();
      c.groups[0].experiments = Array.from({ length: 1000 }, (_, i) =>
        `${n}-${i}`.padEnd(495, 'y'),
      );
      return entry(`e${n}`, 1, c);
    });
    const r = writeSaved({ activeId: null, configs }, st);
    expect(r).toEqual({ ok: false, reason: 'too-large' });
    expect(st.map.has(STORAGE_KEY)).toBe(false);
  });

  it('maps storage errors', () => {
    const st = new MemoryStorage();
    writeSaved({ activeId: 'a', configs: [entry('a')] }, st);
    const before = st.map.get(STORAGE_KEY);
    st.failWith = new DOMException('full', 'QuotaExceededError');
    expect(writeSaved({ activeId: 'b', configs: [entry('b')] }, st)).toEqual({
      ok: false,
      reason: 'quota',
    });
    expect(st.map.get(STORAGE_KEY)).toBe(before);
    st.failWith = new Error('boom');
    expect(writeSaved({ activeId: 'b', configs: [entry('b')] }, st)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('capSaved and helpers', () => {
  it('drops the oldest non-active entries', () => {
    const list = Array.from({ length: 51 }, (_, i) => entry(`id${i}`, 100 + i));
    expect(capSaved(list.slice(0, 50), null)).toHaveLength(50);
    const r = capSaved(list, 'id0'); // the active one is the oldest
    expect(r).toHaveLength(50);
    expect(r.map((c) => c.id)).toContain('id0');
    expect(r.map((c) => c.id)).not.toContain('id1');
    expect(r.map((c) => c.id)).toEqual(list.filter((c) => c.id !== 'id1').map((c) => c.id));
  });

  it('breaks updatedAt ties by dropping the later position', () => {
    const list = Array.from({ length: 51 }, (_, i) => entry(`id${i}`, 5));
    expect(capSaved(list, null).map((c) => c.id)).not.toContain('id50');
  });

  it('makes valid ids and estimates bytes', () => {
    const id = newSavedId();
    expect(id).toHaveLength(36);
    expect(SAVED_ID_RE.test(id)).toBe(true);
    const state = { activeId: null, configs: [] };
    expect(storageBytes(state)).toBe(JSON.stringify({ version: 1, ...state }).length * 2);
  });
});
