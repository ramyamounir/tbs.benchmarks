import { extent } from 'd3-array';
import { scaleBand, scaleLinear, scalePoint, type ScaleBand, type ScaleLinear } from 'd3-scale';

/*
 * Pure scale helpers shared by the chart components (spec Phase 5b "Sizes"). No DOM; tested in
 * scales.test.ts.
 */

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const MARGINS: Margins = { top: 24, right: 16, bottom: 56, left: 48 };
export const GROUP_PADDING = 0.25;
export const BAR_PADDING = 0.08;
export const DOT_ROW_HEIGHT = 21;
export const MARKER_RADIUS = 4.5;
export const TREND_LINE_WIDTH = 1.5;
export const TREND_LINE_HOVER_WIDTH = 3;

/**
 * Value (y) domain over the finite `values`: includes 0 when `fromZero`, padded by 5 % of the span
 * on the free side(s) so the largest bar never touches the frame, `[0, 1]` when nothing is finite,
 * and a ±1 (or ±10 %) window around a single repeated value.
 */
export function valueDomain(values: (number | null)[], fromZero: boolean): [number, number] {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  let [lo, hi] = extent(finite) as [number, number];
  if (fromZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    return [fromZero && lo >= 0 ? 0 : lo - pad, fromZero && hi <= 0 ? 0 : hi + pad];
  }
  const pad = (hi - lo) * 0.05;
  return [fromZero && lo === 0 ? 0 : lo - pad, fromZero && hi === 0 ? 0 : hi + pad];
}

/**
 * Δ (x) domain of the dot plot: symmetric around 0 (the zero line sits in the middle), wide enough
 * for every finite Δ and for the largest drawn tolerance band half-width, so no band is clipped.
 */
export function deltaDomain(deltas: (number | null)[], bandHalfWidth: number): [number, number] {
  let m = Math.max(0, Number.isFinite(bandHalfWidth) ? bandHalfWidth : 0);
  for (const d of deltas) if (d !== null && Number.isFinite(d)) m = Math.max(m, Math.abs(d));
  if (m === 0) return [-1, 1];
  m *= 1.08;
  return [-m, m];
}

/** Linear scale over `domain`, niced, onto `range`. */
export function linear(
  domain: [number, number],
  range: [number, number],
  nice = true,
): ScaleLinear<number, number> {
  const s = scaleLinear().domain(domain).range(range);
  return nice ? s.nice() : s;
}

/** Outer band (one per experiment) and inner band (one per series) of the grouped bars. */
export function groupedBands(
  groups: string[],
  series: string[],
  width: number,
): { outer: ScaleBand<string>; inner: ScaleBand<string> } {
  const outer = scaleBand<string>()
    .domain(groups)
    .range([0, Math.max(0, width)])
    .paddingInner(GROUP_PADDING)
    .paddingOuter(GROUP_PADDING / 2);
  const inner = scaleBand<string>()
    .domain(series)
    .range([0, outer.bandwidth()])
    .padding(BAR_PADDING);
  return { outer, inner };
}

/** Trend x positions: one point per step (baseline then runs), half a step of padding. */
export function trendX(steps: string[], width: number) {
  return scalePoint<string>()
    .domain(steps)
    .range([0, Math.max(0, width)])
    .padding(0.3);
}

/** Signed tick text with a real minus: "+2", "−4", "0". */
export function signedTick(n: number, decimals = 0): string {
  if (n === 0 || Object.is(n, -0)) return '0';
  const t = Math.abs(n).toFixed(decimals);
  if (/^[0.]*$/.test(t)) return '0';
  return `${n < 0 ? '−' : '+'}${t}`;
}

/** Fewest decimals (0–4) that print every tick exactly (ticks are niced, e.g. 0.25 → 2). */
export function tickDecimals(ticks: number[]): number {
  for (let d = 0; d < 4; d++) {
    if (ticks.every((t) => Math.abs(Number(t.toFixed(d)) - t) < 1e-9)) return d;
  }
  return 4;
}

/** Plain tick text (y axes): fixed decimals, real minus sign. */
export function plainTick(n: number, decimals: number): string {
  const t = Math.abs(n).toFixed(decimals);
  if (/^[0.]*$/.test(t)) return t;
  return n < 0 ? `−${t}` : t;
}

/**
 * End-label placement (trend): label ys moved apart so neighbours are at least `gap` px apart,
 * keeping the input order of equal ys and staying inside `[min, max]` when there is room.
 * Returns new ys in the input order.
 */
export function spreadLabels(ys: number[], gap: number, min: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const out = order.map((o) => o.y);
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + gap);
  // Pull the stack back up when it overflows the bottom, then clamp the top.
  if (out.length > 0 && out[out.length - 1] > max) {
    out[out.length - 1] = max;
    for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] - gap);
  }
  if (out.length > 0 && out[0] < min) {
    out[0] = min;
    for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + gap);
  }
  const res = new Array<number>(ys.length);
  order.forEach((o, k) => (res[o.i] = out[k]));
  return res;
}

/** Advance width of one character of the 10 px mono font, for wrapping SVG text. */
export const MONO_10PX_CHAR_PX = 6.2;
export const FOOTNOTE_LINE_PX = 12;

/**
 * Greedy word wrap at spaces for SVG `<text>` (which never wraps itself): no line longer than
 * `maxChars` unless a single word is, words never split, `[]` for an empty text.
 */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (word === '') continue;
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= Math.max(1, maxChars)) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** Footnote lines that fit `widthPx` of 10 px mono text (at least 8 characters per line). */
export function footnoteLines(text: string, widthPx: number): string[] {
  return wrapText(text, Math.max(8, Math.floor(widthPx / MONO_10PX_CHAR_PX)));
}

/** Columns of the small-multiples grid: as many panels of ≥ `minPanel` px as fit, at least 1. */
export function gridColumns(width: number, minPanel: number, count: number): number {
  if (count <= 0) return 1;
  return Math.max(1, Math.min(count, Math.floor(width / minPanel)));
}
