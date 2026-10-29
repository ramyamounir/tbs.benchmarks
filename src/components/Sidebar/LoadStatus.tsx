import { useAppStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { Button } from '../ui/Button';

/** Progress pill while a load is pending, and the load errors (every file-derived part escaped). */
export function LoadStatus() {
  const loading = useAppStore((s) => s.sources.loading);
  const errors = useAppStore((s) => s.sources.errors);
  const clear = useAppStore((s) => s.clearLoadErrors);
  if (loading === null && errors.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {loading !== null && (
        <div
          role="status"
          className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-row-alt px-3 py-1 text-[11px] text-muted"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent"
          />
          {loading.total > 0 ? (
            <span className="min-w-0 truncate">
              Reading {loading.total} {loading.total === 1 ? 'file' : 'files'}… {loading.done}/
              {loading.total}
            </span>
          ) : (
            <span className="flex min-w-0 gap-1">
              <span className="shrink-0">Loading</span>
              <DisplayName value={loading.label} />
              <span className="shrink-0">…</span>
            </span>
          )}
        </div>
      )}
      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger bg-panel px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-danger">
              {errors.length} load {errors.length === 1 ? 'problem' : 'problems'}
            </span>
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear
            </Button>
          </div>
          <ul className="mt-1 flex max-h-[160px] flex-col gap-1 overflow-y-auto">
            {errors.map((e, i) => (
              <li key={i} className="flex min-w-0 flex-col text-[11px]">
                <DisplayName value={e.file} className="font-mono text-text" />
                <DisplayName value={e.message} className="text-muted" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
