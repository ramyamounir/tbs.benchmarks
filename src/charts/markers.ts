/*
 * Marker shapes for run series in dot / line charts (spec Phase 1 "Design tokens" rules): circle,
 * square, diamond, triangle, cross, star in run order, so a run is identifiable without colour.
 * Paths are centred on (0, 0) with radius `r`; place them with `transform="translate(x,y)"`.
 */

export type MarkerShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'cross' | 'star';

export const MARKERS: readonly MarkerShape[] = [
  'circle',
  'square',
  'diamond',
  'triangle',
  'cross',
  'star',
];

const f = (n: number) => Number(n.toFixed(3));

export function markerPath(shape: MarkerShape, r: number): string {
  switch (shape) {
    case 'circle':
      return `M${f(-r)},0A${f(r)},${f(r)} 0 1,0 ${f(r)},0A${f(r)},${f(r)} 0 1,0 ${f(-r)},0Z`;
    case 'square': {
      const s = r * 0.9;
      return `M${f(-s)},${f(-s)}H${f(s)}V${f(s)}H${f(-s)}Z`;
    }
    case 'diamond': {
      const s = r * 1.25;
      return `M0,${f(-s)}L${f(s)},0L0,${f(s)}L${f(-s)},0Z`;
    }
    case 'triangle': {
      const s = r * 1.2;
      return `M0,${f(-s)}L${f(s * 0.95)},${f(s * 0.75)}L${f(-s * 0.95)},${f(s * 0.75)}Z`;
    }
    case 'cross': {
      const a = r * 1.1;
      const b = r * 0.38;
      return `M${f(-b)},${f(-a)}H${f(b)}V${f(-b)}H${f(a)}V${f(b)}H${f(b)}V${f(a)}H${f(-b)}V${f(b)}H${f(-a)}V${f(-b)}H${f(-b)}Z`;
    }
    case 'star': {
      const outer = r * 1.3;
      const inner = outer * 0.45;
      let d = '';
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? outer : inner;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        d += `${i === 0 ? 'M' : 'L'}${f(Math.cos(a) * rad)},${f(Math.sin(a) * rad)}`;
      }
      return `${d}Z`;
    }
  }
}

/** Marker of a series by its index in `sources.runs`; the baseline (-1) is a circle. */
export function runMarker(index: number): MarkerShape {
  return index < 0 ? 'circle' : MARKERS[index % MARKERS.length];
}
