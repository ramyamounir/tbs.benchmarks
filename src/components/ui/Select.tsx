import type { SelectHTMLAttributes } from 'react';

export interface SelectOption<T extends string> {
  value: T;
  /** Plain text (native <option> cannot hold markup); pass file-derived labels through displayName().text. */
  label: string;
  disabled?: boolean;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  mono = false,
  className,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  value: T;
  onChange(value: T): void;
  options: SelectOption<T>[];
  mono?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.currentTarget.value as T)}
      className={`h-8 min-w-0 rounded-md border border-border bg-panel px-2 text-[13px] text-text focus-visible:outline-2 focus-visible:outline-accent ${mono ? 'font-mono' : ''} ${className ?? ''}`}
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
