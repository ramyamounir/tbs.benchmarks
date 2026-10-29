import { useEffect, useRef } from 'react';
import { SHORTCUTS } from '../state/keyboard';
import { useAppStore } from '../state/store';

/**
 * Top-bar "?" button and its popover documenting every keyboard shortcut (spec Phase 7 "Keyboard
 * map"). Open state lives in the store so the `?` key and `Esc` (src/state/keyboard.ts) drive it.
 */
export function ShortcutsPopover() {
  const open = useAppStore((s) => s.ui.shortcutsOpen);
  const setOpen = useAppStore((s) => s.setShortcutsOpen);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, setOpen]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={() => setOpen(!open)}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-panel text-[13px] font-semibold text-muted hover:bg-row-alt hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        ?
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Keyboard shortcuts"
          className="absolute top-full right-0 z-50 mt-1 w-[min(340px,calc(100vw-24px))] rounded-lg border border-border bg-panel p-3 shadow-lg"
        >
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
            Keyboard shortcuts
          </h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-[12px]">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="contents">
                <dt className="justify-self-start rounded border border-border bg-row-alt px-1.5 font-mono text-[11px] whitespace-nowrap text-text">
                  {s.keys}
                </dt>
                <dd className="m-0 text-text">{s.action}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] text-faint">
            Letter and number keys work when no text field is focused.
          </p>
        </div>
      )}
    </div>
  );
}
