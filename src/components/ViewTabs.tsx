import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useReady } from '../state/selectors';
import { NEEDS_RUNS, useAppStore, type View } from '../state/store';

const TABS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'table', label: 'Table' },
  { id: 'charts', label: 'Charts' },
  { id: 'config', label: 'Config' },
  { id: 'writeback', label: 'Write-back' },
];

/**
 * Overview / Table / Charts / Config / Write-back. There is no Start tab: Start renders under
 * Overview. Table, Charts and Write-back are disabled until a baseline and a run are loaded.
 */
export function ViewTabs() {
  const view = useAppStore((s) => s.ui.view);
  const ready = useReady();
  const setView = useAppStore((s) => s.setView);
  const refs = useRef(new Map<View, HTMLButtonElement>());
  const enabled = TABS.filter((t) => ready || !NEEDS_RUNS.has(t.id));
  // Narrow widths scroll the strip: keep the current tab visible (also after `1`–`5`).
  useEffect(() => {
    refs.current.get(view)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [view]);

  const onKeyDown = (e: KeyboardEvent) => {
    const i = enabled.findIndex((t) => t.id === view);
    let next: (typeof TABS)[number] | undefined;
    if (e.key === 'ArrowRight') next = enabled[(i + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(i - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    setView(next.id);
    refs.current.get(next.id)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Views"
      onKeyDown={onKeyDown}
      className="flex min-w-0 shrink items-center gap-0.5 overflow-x-auto [scrollbar-width:none] rounded-lg border border-border bg-panel p-0.5"
    >
      {TABS.map((t) => {
        const selected = t.id === view;
        const disabled = !ready && NEEDS_RUNS.has(t.id);
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
              else refs.current.delete(t.id);
            }}
            type="button"
            role="tab"
            id={`view-tab-${t.id}`}
            aria-controls="main-view"
            aria-selected={selected}
            aria-disabled={disabled || undefined}
            tabIndex={selected ? 0 : -1}
            title={disabled ? 'Load a baseline and at least one run first' : undefined}
            onClick={() => {
              if (!disabled) setView(t.id);
            }}
            className={`h-7 shrink-0 rounded-md px-3 text-[13px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-accent ${
              selected
                ? 'bg-accent-bg font-medium text-accent'
                : disabled
                  ? 'cursor-not-allowed text-faint'
                  : 'text-text hover:bg-row-alt'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
