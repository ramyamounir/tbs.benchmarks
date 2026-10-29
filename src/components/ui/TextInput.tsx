import type { InputHTMLAttributes, Ref } from 'react';

export function TextInput({
  value,
  onChange,
  mono = false,
  invalid = false,
  className,
  ref,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange(value: string): void;
  mono?: boolean;
  /** Sets aria-invalid and the danger border; pair it with aria-describedby for the message. */
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      autoComplete="off"
      className={`h-8 min-w-0 rounded-md border bg-panel px-2.5 text-[13px] text-text placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent ${
        invalid ? 'border-danger' : 'border-border'
      } ${mono ? 'font-mono' : ''} ${className ?? ''}`}
      {...rest}
    />
  );
}
