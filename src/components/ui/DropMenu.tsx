import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from './Button';

export interface DropMenuItem {
  key: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Why the item is disabled; shown under it. */
  hint?: ReactNode;
  onSelect(): void;
}

/**
 * Button that opens a menu. Arrow keys move, `Esc` closes and refocuses the trigger, an outside
 * click closes. Disabled items stay focusable for their hint but ignore activation.
 */
export function DropMenu({
  label,
  items,
  ariaLabel,
  variant = 'secondary',
  size = 'md',
  align = 'left',
}: {
  label: ReactNode;
  items: DropMenuItem[];
  ariaLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    list.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>('button')?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      buttons[(i + step + buttons.length) % buttons.length]?.focus();
    }
  };

  return (
    <div ref={root} className="relative inline-flex" onKeyDown={onKeyDown}>
      <Button
        variant={variant}
        size={size}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </Button>
      {open && (
        <ul
          ref={list}
          role="menu"
          className={`absolute top-full z-30 mt-1 max-h-[60vh] w-max max-w-[min(360px,90vw)] min-w-[200px] overflow-y-auto rounded-lg border border-border bg-panel py-1 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((it) => (
            <li key={it.key} role="none">
              <button
                type="button"
                role="menuitem"
                aria-disabled={it.disabled || undefined}
                onClick={() => {
                  if (it.disabled) return;
                  setOpen(false);
                  it.onSelect();
                }}
                className={`flex w-full min-w-0 flex-col items-start px-3 py-1.5 text-left text-[13px] outline-none hover:bg-row-alt focus-visible:bg-row-alt ${
                  it.disabled ? 'cursor-not-allowed text-faint' : 'text-text'
                }`}
              >
                <span className="min-w-0">{it.label}</span>
                {it.description !== undefined && (
                  <span className="text-[11px] text-muted">{it.description}</span>
                )}
                {it.disabled && it.hint !== undefined && (
                  <span className="text-[11px] text-faint">{it.hint}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
