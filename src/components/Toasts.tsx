import { useAppStore, type ToastKind } from '../state/store';

const BORDER: Record<ToastKind, string> = {
  info: 'border-border',
  warn: 'border-warn',
  error: 'border-danger',
};
const GLYPH: Record<ToastKind, string> = { info: 'i', warn: '!', error: '×' };
const GLYPH_CLASS: Record<ToastKind, string> = {
  info: 'text-accent',
  warn: 'text-warn',
  error: 'text-danger',
};

/**
 * Transient notices, bottom-right (spec Phase 1 "Toasts"). Text is plain text rendered as a React
 * child; callers pass file-derived parts through displayName() first. Toasts never take focus.
 */
export function Toasts() {
  const toasts = useAppStore((s) => s.ui.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-[calc(100vw-32px)] max-w-[360px] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : undefined}
          className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-panel px-3 py-2.5 text-[13px] text-text shadow-lg ${BORDER[t.kind]}`}
        >
          <span
            aria-hidden="true"
            className={`w-3 shrink-0 text-center font-mono font-semibold ${GLYPH_CLASS[t.kind]}`}
          >
            {GLYPH[t.kind]}
          </span>
          <span className="min-w-0 flex-1 break-words">{t.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
            className="shrink-0 rounded px-1.5 text-[12px] text-accent hover:bg-accent-bg"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
