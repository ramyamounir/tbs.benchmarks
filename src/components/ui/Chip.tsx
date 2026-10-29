import type { ReactNode } from 'react';
import type { Verdict } from '../../model/types';
import { VERDICT_CHIP_CLASS, VERDICT_GLYPH } from './verdict';

type ChipProps =
  /** A verdict summary, e.g. "▲ 3" or "▼ worse". */
  | { variant: 'verdict'; verdict: Verdict; children: ReactNode; title?: string }
  /** A Δ chip next to a value, e.g. "▼ +2.29" (monospace). */
  | { variant: 'diff'; verdict: Verdict; children: ReactNode; title?: string }
  /** A neutral or warning count, e.g. "= 12 same", "! episodes", "2 rows". */
  | {
      variant: 'count';
      glyph: string;
      tone?: 'neutral' | 'warn';
      children: ReactNode;
      title?: string;
    };

/** Small label; always text plus a glyph so colour never carries meaning alone. */
export function Chip(props: ChipProps) {
  const base =
    'inline-flex max-w-full min-w-0 shrink-0 items-center gap-1 rounded border px-1.5 leading-[18px] whitespace-nowrap';
  if (props.variant === 'count') {
    const tone =
      props.tone === 'warn'
        ? 'bg-warn-bg text-warn border-transparent'
        : 'bg-row-alt text-muted border-border';
    return (
      <span className={`${base} text-[11px] ${tone}`} title={props.title}>
        <span aria-hidden="true">{props.glyph}</span>
        {props.children}
      </span>
    );
  }
  const size = props.variant === 'diff' ? 'font-mono text-[11px]' : 'text-[11px] font-medium';
  return (
    <span className={`${base} ${size} ${VERDICT_CHIP_CLASS[props.verdict]}`} title={props.title}>
      <span aria-hidden="true">{VERDICT_GLYPH[props.verdict]}</span>
      {props.children}
    </span>
  );
}
