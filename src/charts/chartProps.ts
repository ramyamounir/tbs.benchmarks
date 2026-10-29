import type { ChartDef } from '../model/types';
import type { ChartTokens } from './colors';
import type { ChartData, ChartEntry } from './data';

/** Props shared by the four chart components. */
export interface ChartProps {
  chart: ChartDef;
  data: ChartData;
  /** Width of the card body (px); the chart lays out to it. */
  width: number;
  /** Height for fixed-height charts (bars, trend); row-based charts grow as needed. */
  height: number;
  tokens: ChartTokens;
  /** Accessible name of the chart (its title). */
  title: string;
  svgRef(el: SVGSVGElement | null): void;
  /** Open an experiment in the Table view. */
  onOpen(entry: ChartEntry): void;
}

/** Bounds of a mark for the tooltip anchor. */
export function markBounds(el: Element) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** Enter / Space on a focusable mark opens it (keyboard equivalent of the click). */
export function onActivateKey(fn: () => void) {
  return (e: { key: string; preventDefault(): void }) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
}
