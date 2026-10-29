import { useState } from 'react';
import type { Bounds } from '../components/ui/tooltipPlacement';
import { displayName } from '../util/displayName';
import { AxisBottom } from './Axis';
import { markBounds, onActivateKey, type ChartProps } from './chartProps';
import { ChartTooltip } from './ChartTooltip';
import { CHART_FONT, runColor, type ChartToken } from './colors';
import { deltaAxisLabel, toleranceFootnote } from './data';
import { markerPath, runMarker } from './markers';
import {
  deltaDomain,
  DOT_ROW_HEIGHT,
  FOOTNOTE_LINE_PX,
  footnoteLines,
  linear,
  MARKER_RADIUS,
  signedTick,
} from './scales';

const TOP = 30;
const BOTTOM = 44;
const RIGHT = 16;

/** Colours of the two halves of the axis label: the worse side vermillion, the better side blue. */
function axisSideTokens(direction: string): [ChartToken, ChartToken] {
  if (direction === 'higher') return ['--worse', '--better'];
  if (direction === 'lower') return ['--better', '--worse'];
  return ['--muted', '--muted'];
}

/** Height a dot plot needs for `rows` experiments and a footnote of `footnoteRows` lines. */
function deltaDotsHeight(rows: number, footnoteRows: number): number {
  return (
    TOP +
    Math.max(1, rows) * DOT_ROW_HEIGHT +
    BOTTOM +
    Math.max(0, footnoteRows - 1) * FOOTNOTE_LINE_PX
  );
}

/**
 * Δ dot plot (spec Phase 5b "Tolerance in charts"): one row per experiment, Δ per run as a coloured
 * marker, grey tolerance band (one over all rows in absolute mode, one per row in percent mode),
 * zero line, direction-aware axis label, "must match" for a `match` metric, footnote.
 */
export function DeltaDots({ chart, data, width, tokens, title, svgRef, onOpen }: ChartProps) {
  const [hover, setHover] = useState<{ i: number; anchor: Bounds } | null>(null);
  const metric = data.metric;
  const rows = data.entries.length;
  // SVG text never wraps on its own: the footnote is split so it stays inside a narrow card.
  const footnote = metric ? footnoteLines(toleranceFootnote(metric), width - 8) : [];
  const height = deltaDotsHeight(rows, footnote.length);
  const left = Math.round(Math.min(240, Math.max(120, width * 0.38)));
  const pw = Math.max(0, width - left - RIGHT);
  const ph = Math.max(1, rows) * DOT_ROW_HEIGHT;
  const band = chart.options.toleranceBand;
  const absTol = data.toleranceMode === 'absolute' ? (metric?.tolerance ?? 0) : 0;
  const halfWidth = band
    ? data.toleranceMode === 'absolute'
      ? absTol
      : Math.max(0, ...data.entries.map((e) => e.effectiveTol ?? 0))
    : 0;
  const deltas = data.entries.flatMap((e) => data.runs.map((r) => e.points[r.id]?.delta ?? null));
  const x = linear(deltaDomain(deltas, halfWidth), [0, pw]);
  const nameChars = Math.max(6, Math.floor((left - 14) / 6.1));
  const [leftTok, rightTok] = axisSideTokens(data.direction);
  const [leftText, rightText] = deltaAxisLabel(data.direction).split(' · ');

  const hovered = hover ? data.entries[hover.i] : undefined;
  return (
    <>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={displayName(title).full}
        fontFamily={CHART_FONT}
      >
        <rect width={width} height={height} fill={tokens['--panel']} />
        <g transform={`translate(${left},${TOP})`}>
          {/* Bands below the zero line and the markers. */}
          {band && data.toleranceMode === 'absolute' && absTol > 0 && (
            <rect
              x={x(-absTol)}
              y={0}
              width={x(absTol) - x(-absTol)}
              height={ph}
              fill={tokens['--row-alt']}
            />
          )}
          {band &&
            data.toleranceMode === 'percent' &&
            data.entries.map((e, i) =>
              e.effectiveTol === null || e.effectiveTol === 0 ? null : (
                <rect
                  key={i}
                  x={x(-e.effectiveTol)}
                  y={i * DOT_ROW_HEIGHT + 3}
                  width={x(e.effectiveTol) - x(-e.effectiveTol)}
                  height={DOT_ROW_HEIGHT - 6}
                  fill={tokens['--row-alt']}
                />
              ),
            )}
          <AxisBottom
            scale={x}
            plotHeight={ph}
            tokens={tokens}
            format={(t, d) => signedTick(t, d)}
          />
          <line x1={x(0)} x2={x(0)} y1={-4} y2={ph} stroke={tokens['--muted']} strokeWidth={1} />
          <g fontFamily={CHART_FONT} fontSize={10}>
            <text x={0} y={-10} fill={tokens[leftTok]}>
              {leftText}
            </text>
            <text x={pw} y={-10} textAnchor="end" fill={tokens[rightTok]}>
              {rightText}
            </text>
            {data.direction === 'match' && (
              <text x={x(0)} y={-10} textAnchor="middle" fill={tokens['--muted']}>
                must match
              </text>
            )}
          </g>
          {data.entries.map((e, i) => {
            const cy = i * DOT_ROW_HEIGHT + DOT_ROW_HEIGHT / 2;
            const name = displayName(e.name);
            const short = displayName(e.name, { max: nameChars });
            const ds = data.runs
              .map((r) => e.points[r.id]?.delta ?? null)
              .filter((d): d is number => d !== null && Number.isFinite(d));
            const lo = Math.min(0, ...ds);
            const hi = Math.max(0, ...ds);
            const isHover = hover?.i === i;
            return (
              <g key={i} data-experiment={name.full}>
                {isHover && (
                  <rect
                    x={-left}
                    y={i * DOT_ROW_HEIGHT}
                    width={left + pw}
                    height={DOT_ROW_HEIGHT}
                    fill={tokens['--heat-same']}
                    fillOpacity={0.7}
                  />
                )}
                <text
                  x={-10}
                  y={cy}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={10}
                  fill={isHover ? tokens['--text'] : tokens['--muted']}
                >
                  {short.text}
                  <title>{short.full}</title>
                </text>
                {ds.length > 0 && (
                  <line
                    x1={x(lo)}
                    x2={x(hi)}
                    y1={cy}
                    y2={cy}
                    stroke={tokens['--border']}
                    strokeWidth={1.5}
                  />
                )}
                {data.runs.map((r, k) => {
                  const d = e.points[r.id]?.delta ?? null;
                  // Small vertical offset per run so equal Δs of several runs stay visible.
                  const dy = (k - (data.runs.length - 1) / 2) * Math.min(3, 12 / data.runs.length);
                  if (d === null || !Number.isFinite(d)) return null;
                  return (
                    <path
                      key={r.id}
                      d={markerPath(runMarker(r.colorIndex), MARKER_RADIUS)}
                      transform={`translate(${x(d)},${cy + dy})`}
                      fill={runColor(tokens, r.colorIndex)}
                      stroke={tokens['--panel']}
                      strokeWidth={1}
                    />
                  );
                })}
                <rect
                  x={-left}
                  y={i * DOT_ROW_HEIGHT}
                  width={left + pw}
                  height={DOT_ROW_HEIGHT}
                  fill={tokens['--panel']}
                  fillOpacity={0}
                  tabIndex={0}
                  role="button"
                  aria-label={`${name.full}: open in Table`}
                  style={{ cursor: 'pointer', outline: 'none' }}
                  onMouseEnter={(ev) => setHover({ i, anchor: markBounds(ev.currentTarget) })}
                  onMouseLeave={() => setHover(null)}
                  onFocus={(ev) => setHover({ i, anchor: markBounds(ev.currentTarget) })}
                  onBlur={() => setHover(null)}
                  onClick={() => onOpen(e)}
                  onKeyDown={onActivateKey(() => onOpen(e))}
                />
              </g>
            );
          })}
          {footnote.length > 0 && (
            <text x={-left + 4} y={ph + 36} fontSize={10} fill={tokens['--faint']}>
              {footnote.map((l, i) => (
                <tspan key={i} x={-left + 4} dy={i === 0 ? 0 : FOOTNOTE_LINE_PX}>
                  {l}
                </tspan>
              ))}
            </text>
          )}
        </g>
      </svg>
      {hover && hovered && (
        <ChartTooltip
          anchor={hover.anchor}
          data={data}
          entry={hovered}
          tokens={tokens}
          onDismiss={() => setHover(null)}
        />
      )}
    </>
  );
}
