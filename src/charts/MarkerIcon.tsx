import { markerPath, type MarkerShape } from './markers';

/** Small inline marker swatch for HTML legends and tooltips (colour = literal token value). */
export function MarkerIcon({
  color,
  shape,
  size = 10,
}: {
  color: string;
  shape: MarkerShape;
  size?: number;
}) {
  const r = size / 2 - 1;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={markerPath(shape, shape === 'square' ? r * 1.1 : r * 0.85)} fill={color} />
    </svg>
  );
}
