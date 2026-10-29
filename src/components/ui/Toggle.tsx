import { useId, type ReactNode } from 'react';

/** Switch with a visible label (sidebar "Show" toggles, write-back options). */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`flex min-w-0 items-center justify-between gap-3 ${className ?? ''}`}>
      <label htmlFor={id} className="min-w-0 text-[13px] text-text">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[18px] w-[30px] shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? 'border-accent bg-accent' : 'border-border bg-row-alt'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-panel shadow transition-[left] ${
            checked ? 'left-[14px]' : 'left-[2px]'
          }`}
        />
      </button>
    </div>
  );
}
