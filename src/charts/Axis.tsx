import type { ScaleLinear } from 'd3-scale';
import { CHART_FONT, type ChartTokens } from './colors';
import { plainTick, tickDecimals } from './scales';

/*
 * Linear axes for the SVG charts: ticks `font-mono 10px --faint`, gridlines `--border` (spec Phase
 * 5b). Colours are literal token values (attributes, never classes) so PNG export keeps them.
 */

/** Horizontal gridlines + tick labels left of the plot (y axis). */
export function AxisLeft({
  scale,
  plotWidth,
  tokens,
  count = 5,
  label,
  plotHeight,
}: {
  scale: ScaleLinear<number, number>;
  plotWidth: number;
  tokens: ChartTokens;
  count?: number;
  /** Axis title (metric units), drawn rotated left of the ticks. */
  label?: string;
  plotHeight?: number;
}) {
  const ticks = scale.ticks(count);
  const d = tickDecimals(ticks);
  return (
    <g aria-hidden="true">
      {ticks.map((t) => (
        <g key={t} transform={`translate(0,${scale(t)})`}>
          <line x1={0} x2={plotWidth} stroke={tokens['--border']} strokeWidth={1} />
          <text
            x={-8}
            dy="0.32em"
            textAnchor="end"
            fontFamily={CHART_FONT}
            fontSize={10}
            fill={tokens['--faint']}
          >
            {plainTick(t, d)}
          </text>
        </g>
      ))}
      {label && plotHeight !== undefined && (
        <text
          transform={`translate(-36,${plotHeight / 2}) rotate(-90)`}
          textAnchor="middle"
          fontFamily={CHART_FONT}
          fontSize={10}
          fill={tokens['--faint']}
        >
          {label}
        </text>
      )}
    </g>
  );
}

/** Vertical gridlines + tick labels below the plot (Δ axis of the dot plot). */
export function AxisBottom({
  scale,
  plotHeight,
  tokens,
  count = 5,
  format,
}: {
  scale: ScaleLinear<number, number>;
  plotHeight: number;
  tokens: ChartTokens;
  count?: number;
  format(t: number, decimals: number): string;
}) {
  const ticks = scale.ticks(count);
  const d = tickDecimals(ticks);
  return (
    <g aria-hidden="true">
      {ticks.map((t) => (
        <g key={t} transform={`translate(${scale(t)},0)`}>
          <line y1={0} y2={plotHeight} stroke={tokens['--border']} strokeWidth={1} />
          <text
            y={plotHeight + 16}
            textAnchor="middle"
            fontFamily={CHART_FONT}
            fontSize={10}
            fill={tokens['--faint']}
          >
            {format(t, d)}
          </text>
        </g>
      ))}
    </g>
  );
}
