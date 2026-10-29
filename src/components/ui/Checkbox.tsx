import { useEffect, useRef, type ReactNode } from 'react';

export function Checkbox({
  checked,
  onChange,
  label,
  aside,
  indeterminate = false,
  disabled,
  className,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  label: ReactNode;
  /** Right-aligned secondary text, e.g. an experiment count. */
  aside?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label
      className={`flex min-w-0 cursor-pointer items-center gap-2 text-[13px] text-text ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${className ?? ''}`}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-accent"
      />
      <span className="flex min-w-0 flex-1">{label}</span>
      {aside !== undefined && <span className="shrink-0 text-[11px] text-faint">{aside}</span>}
    </label>
  );
}
