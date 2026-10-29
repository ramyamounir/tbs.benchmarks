import type { ReactNode } from 'react';

/** Radio card (Start "Config" choices, write-back run picker) or plain radio row. */
export function Radio({
  name,
  checked,
  onChange,
  label,
  description,
  card = false,
  disabled,
  className,
}: {
  name: string;
  checked: boolean;
  onChange(): void;
  label: ReactNode;
  description?: ReactNode;
  card?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const frame = card
    ? `rounded-lg border px-3 py-2.5 ${checked ? 'border-accent bg-accent-bg' : 'border-border bg-panel hover:bg-row-alt'}`
    : '';
  return (
    <label
      className={`flex min-w-0 cursor-pointer items-start gap-2.5 ${frame} ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${className ?? ''}`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange()}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-medium text-text">{label}</span>
        {description !== undefined && <span className="text-[11px] text-muted">{description}</span>}
      </span>
    </label>
  );
}
