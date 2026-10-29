/*
 * Chart colours (spec Phase 5b). Chart SVGs never use classes or CSS variables: components set
 * `fill` / `stroke` from these token names, resolved to literal values by `useTokens()` (so the
 * exported PNG, rendered outside the page, keeps its colours).
 */

/** Every token a chart may draw with; also the list PNG export resolves. */
export const CHART_TOKENS = [
  '--panel',
  '--border',
  '--text',
  '--muted',
  '--faint',
  '--accent',
  '--row-alt',
  '--select',
  '--baseline',
  '--better',
  '--better-bg',
  '--worse',
  '--worse-bg',
  '--warn',
  '--heat-same',
  '--run-1',
  '--run-2',
  '--run-3',
  '--run-4',
  '--run-5',
  '--run-6',
] as const;

export type ChartToken = (typeof CHART_TOKENS)[number];
export type ChartTokens = Record<ChartToken, string>;

/** The same value Phase 1 puts in `--font-mono` (not read from CSS: `@theme inline` may not emit it). */
export const CHART_FONT = "'JetBrains Mono', ui-monospace, monospace";

const RUN_TOKENS = ['--run-1', '--run-2', '--run-3', '--run-4', '--run-5', '--run-6'] as const;

/** Token of a series: `--baseline` for index -1, else `--run-<n>` by position in `sources.runs`. */
export function runToken(index: number): ChartToken {
  if (index < 0) return '--baseline';
  return RUN_TOKENS[index % RUN_TOKENS.length];
}

/** Literal colour of a series (index -1 = baseline). */
export function runColor(tokens: ChartTokens, index: number): string {
  return tokens[runToken(index)];
}

/** Colour of a Δ label / marker accent by verdict (blue better, vermillion worse, never red/green). */
export function verdictToken(verdict: string): ChartToken {
  switch (verdict) {
    case 'better':
      return '--better';
    case 'worse':
    case 'mismatch':
      return '--worse';
    case 'same':
      return '--muted';
    default:
      return '--faint';
  }
}
