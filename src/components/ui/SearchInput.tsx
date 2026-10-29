import { useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.matches('input, textarea, select, [contenteditable], [contenteditable] *');
}

/**
 * Filter box. With `shortcut`, `/` focuses and selects it (the app's only `/` handler; each view
 * passes `shortcut` to exactly one mounted SearchInput, its main filter).
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  shortcut = false,
  ariaLabel,
  className,
}: {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  shortcut?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(document.activeElement)) return;
      if (useAppStore.getState().ui.modal !== null) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shortcut]);
  return (
    <div className={`relative flex min-w-0 items-center ${className ?? ''}`}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 text-faint"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder ?? 'Filter'}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value !== '') {
            e.stopPropagation();
            onChange('');
          }
        }}
        className="h-8 w-full min-w-0 rounded-md border border-border bg-panel pr-7 pl-8 text-[13px] text-text placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent"
      />
      {shortcut && (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2 rounded border border-border px-1 font-mono text-[10px] text-faint"
        >
          /
        </kbd>
      )}
    </div>
  );
}
