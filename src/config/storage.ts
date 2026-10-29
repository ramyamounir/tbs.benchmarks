import type { SavedConfig } from '../model/types';
import { isPlainObject, validateConfig } from './schema';

/**
 * Saved configs in `localStorage` (spec Phase 2b "Saved-config storage contract"). The only module
 * that touches localStorage for configs. Everything read back is untrusted (corrupt, hand-edited or
 * written by another version), so the envelope and every entry are validated, and no function here
 * ever throws. Pure: the store (Phase 3) decides when to read and write.
 */

export const STORAGE_KEY = 'tbp-benchmarks-configs';
export const CORRUPT_KEY = 'tbp-benchmarks-configs.corrupt';
export const SAVED_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_SAVED = 50;
export const MAX_SAVED_NAME = 120;
export const MAX_SAVED_CONFIG_CHARS = 524_288;
export const MAX_SAVED_PAYLOAD_CHARS = 4_194_304;

export type SavedState = { activeId: string | null; configs: SavedConfig[] };
export type WriteResult =
  { ok: true } | { ok: false; reason: 'quota' | 'too-large' | 'unavailable'; id?: string };

const empty = (): SavedState => ({ activeId: null, configs: [] });

/** Resolve the storage inside the caller's try: merely reading `localStorage` can throw. */
function resolve(storage?: Storage): Storage | null {
  return storage ?? globalThis.localStorage ?? null;
}

/** Copy the untouched raw value aside once, so a user can recover it from devtools. */
function backup(st: Storage, raw: string): void {
  try {
    if (st.getItem(CORRUPT_KEY) !== null) return;
    st.setItem(CORRUPT_KEY, raw);
    console.warn(
      `Saved configs were partly unreadable; the original value is kept in localStorage["${CORRUPT_KEY}"].`,
    );
  } catch {
    // A quota error while backing up is ignored: reading must still succeed.
  }
}

export function readSaved(storage?: Storage): SavedState {
  let st: Storage | null;
  let raw: string | null;
  try {
    st = resolve(storage);
    if (!st) return empty();
    raw = st.getItem(STORAGE_KEY);
  } catch {
    return empty();
  }
  if (raw === null) return empty();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    backup(st, raw);
    return empty();
  }
  if (
    !isPlainObject(parsed) ||
    !Object.hasOwn(parsed, 'version') ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.configs)
  ) {
    backup(st, raw);
    return empty();
  }

  const configs: SavedConfig[] = [];
  const ids = new Set<string>();
  let dropped = false;
  const drop = (i: number, reason: string) => {
    dropped = true;
    console.warn(`Saved config #${i} dropped: ${reason}`);
  };
  parsed.configs.forEach((entry: unknown, i: number) => {
    if (!isPlainObject(entry)) return drop(i, 'not an object');
    const id = Object.hasOwn(entry, 'id') ? entry.id : undefined;
    if (typeof id !== 'string' || !SAVED_ID_RE.test(id)) return drop(i, 'invalid id');
    if (ids.has(id)) return drop(i, 'duplicate id');
    const rawName = Object.hasOwn(entry, 'name') ? entry.name : undefined;
    if (typeof rawName !== 'string') return drop(i, 'invalid name');
    let name = rawName;
    const updatedAt = Object.hasOwn(entry, 'updatedAt') ? entry.updatedAt : undefined;
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0)
      return drop(i, 'invalid updatedAt');
    const rawConfig = Object.hasOwn(entry, 'config') ? entry.config : undefined;
    if (!isPlainObject(rawConfig)) return drop(i, 'config is not an object');
    const { config, issues } = validateConfig(rawConfig);
    if (issues.some((x) => x.severity === 'error')) return drop(i, 'config has errors');
    if (issues.length > 0) console.warn(`Saved config #${i}: ${issues.length} warning(s)`);
    if (configs.length >= MAX_SAVED) return drop(i, `more than ${MAX_SAVED} saved configs`);
    if (name.length > MAX_SAVED_NAME) {
      console.warn(`Saved config #${i}: name truncated to ${MAX_SAVED_NAME} characters`);
      name = name.slice(0, MAX_SAVED_NAME);
    }
    ids.add(id);
    configs.push({ id, name, updatedAt, config });
  });
  if (dropped) backup(st, raw);

  const active = Object.hasOwn(parsed, 'activeId') ? parsed.activeId : undefined;
  const activeId =
    typeof active === 'string' && ids.has(active) ? active : (configs[0]?.id ?? null);
  return { activeId, configs };
}

function isQuotaError(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  return (
    typeof DOMException !== 'undefined' &&
    e instanceof DOMException &&
    (e.code === 22 || e.code === 1014)
  );
}

export function writeSaved(state: SavedState, storage?: Storage): WriteResult {
  let payload: string;
  try {
    for (const entry of state.configs) {
      if (JSON.stringify(entry.config).length > MAX_SAVED_CONFIG_CHARS)
        return { ok: false, reason: 'too-large', id: entry.id };
    }
    payload = JSON.stringify({
      version: 1,
      activeId: state.activeId,
      configs: state.configs.map((c) => ({
        id: c.id,
        name: c.name,
        updatedAt: c.updatedAt,
        config: c.config,
      })),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (payload.length > MAX_SAVED_PAYLOAD_CHARS) return { ok: false, reason: 'too-large' };
  try {
    const st = resolve(storage);
    if (!st) return { ok: false, reason: 'unavailable' };
    st.setItem(STORAGE_KEY, payload);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: isQuotaError(e) ? 'quota' : 'unavailable' };
  }
}

/**
 * Keep the list within MAX_SAVED: drop the oldest entries by `updatedAt` (ties: the later array
 * position first), never the active one; the relative order of the kept entries is preserved.
 */
export function capSaved(configs: SavedConfig[], activeId: string | null): SavedConfig[] {
  if (configs.length <= MAX_SAVED) return configs;
  const candidates = configs
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.id !== activeId)
    .sort((a, b) => a.c.updatedAt - b.c.updatedAt || b.i - a.i);
  const drop = new Set<number>();
  for (const { i } of candidates) {
    if (configs.length - drop.size <= MAX_SAVED) break;
    drop.add(i);
  }
  return configs.filter((_, i) => !drop.has(i));
}

export function newSavedId(): string {
  return globalThis.crypto.randomUUID();
}

/** Display estimate (UTF-16 bytes) for the Saved popover footer. */
export function storageBytes(state: SavedState): number {
  return JSON.stringify({ version: 1, ...state }).length * 2;
}
