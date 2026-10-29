import type { LoadError, Source } from '../model/types';
import { useAppStore, type LoadRole } from '../state/store';

export type Loader = (
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
) => Promise<{ sources: Source[]; errors: LoadError[] }>;

/**
 * The single glue every load entry point calls (spec Phase 3): beginLoad → loader → commitLoad,
 * exactly once. Components never call beginLoad/commitLoad themselves. Staleness (a newer baseline
 * load) is decided by commitLoad's op id, not by the signal.
 */
export async function runLoad(role: LoadRole, label: string, loader: Loader): Promise<void> {
  const store = useAppStore.getState();
  const { opId, signal } = store.beginLoad(role, label);
  let result: { sources: Source[]; errors: LoadError[] };
  try {
    result = await loader(signal, (d, t) => useAppStore.getState().reportProgress(opId, d, t));
  } catch (err) {
    // Defensive only: loaders never throw.
    result = { sources: [], errors: [{ file: label, message: String(err), reason: 'parse' }] };
  }
  useAppStore.getState().commitLoad(opId, result.sources, result.errors);
}
