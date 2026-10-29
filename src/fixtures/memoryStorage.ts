// Test helper (never imported by app code): an in-memory `Storage` whose `setItem` can be made to
// throw, to simulate a full quota or storage that is unavailable.

export interface MemoryStorage extends Storage {
  data: Map<string, string>;
  /** When set, `setItem` throws this (a fresh value per call is fine). */
  failWith: (() => unknown) | null;
  setItemCalls: { key: string; value: string }[];
}

export function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const data = new Map(Object.entries(initial));
  const st: MemoryStorage = {
    data,
    failWith: null,
    setItemCalls: [],
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    key(i: number) {
      return [...data.keys()][i] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      if (st.failWith) throw st.failWith();
      st.setItemCalls.push({ key, value });
      data.set(key, String(value));
    },
  };
  return st;
}
