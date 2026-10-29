import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

/** Radio-group of buttons ("Δ ÷ tolerance | Δ %", direction, match mode). Arrow keys move. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  dense = false,
  scroll = false,
}: {
  options: Segment<T>[];
  value: T;
  onChange(value: T): void;
  ariaLabel: string;
  className?: string;
  /** Segments sized by their label (not equal widths), smaller padding: long labels in narrow panels. */
  dense?: boolean;
  /** Keep every label whole and scroll sideways instead of truncating (narrow layouts, Phase 7). */
  scroll?: boolean;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const enabled = options.filter((o) => !o.disabled);
  const onKeyDown = (e: KeyboardEvent) => {
    const i = enabled.findIndex((o) => o.value === value);
    let next: Segment<T> | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(i + 1) % enabled.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = enabled[(i - 1 + enabled.length) % enabled.length];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`flex min-w-0 rounded-md border border-border bg-row-alt p-0.5 ${scroll ? 'max-w-full overflow-x-auto [scrollbar-width:none]' : ''} ${className ?? ''}`}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              if (el) refs.current.set(o.value, el);
              else refs.current.delete(o.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={o.disabled}
            tabIndex={selected ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`${scroll ? 'shrink-0' : 'min-w-0'} truncate rounded py-1 text-[12px] ${dense ? 'flex-auto px-1.5' : 'flex-1 px-2'} focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-faint ${
              selected ? 'bg-panel font-semibold text-text shadow-sm' : 'text-muted hover:text-text'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
