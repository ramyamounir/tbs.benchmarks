import { line } from 'd3-shape';
import { useMemo, useState } from 'react';
import type { Bounds } from '../components/ui/tooltipPlacement';
import { displayName } from '../util/displayName';
import { AxisLeft } from './Axis';
import { onActivateKey, type ChartProps } from './chartProps';
import { ChartTooltip } from './ChartTooltip';
import { CHART_FONT, runColor } from './colors';
import { trendOrder, TREND_FOOTNOTE, type ChartEntry, type ChartSeries } from './data';
import { markerPath, runMarker } from './markers';
import {
  FOOTNOTE_LINE_PX,
  footnoteLines,
  linear,
  spreadLabels,
  TREND_LINE_HOVER_WIDTH,
  TREND_LINE_WIDTH,
  trendX,
  valueDomain,
} from './scales';

const TOP = 24;
const BOTTOM = 62;
const LEFT = 48;

function valueAt(e: ChartEntry, s: ChartSeries): number | null {
  const v = s.colorIndex < 0 ? e.base : (e.points[s.id]?.value ?? null);
  return v !== null && Number.isFinite(v) ? v : null;
}

/**
 * Trend across runs (spec Phase 5b): x = baseline then the visible runs in date order (oldest
 * first), one line per experiment with end labels, hovered line thickened and the others dimmed.
 */
export function Trend({ chart, data, width, height, tokens, title, svgRef, onOpen }: ChartProps) {
  const [hover, setHover] = useState<{ i: number; anchor: Bounds } | null>(null);
  const right = Math.round(Math.min(180, Math.max(90, width * 0.22)));
  const pw = Math.max(0, width - LEFT - right);
  const ph = Math.max(0, height - TOP - BOTTOM);
  const steps = useMemo(
    () => [data.baseline, ...trendOrder(data.runs)],
    [data.baseline, data.runs],
  );
  const x = trendX(
    steps.map((s) => s.id),
    pw,
  );
  const values = data.entries.flatMap((e) => steps.map((s) => valueAt(e, s)));
  const y = linear(valueDomain(values, chart.options.yFromZero), [ph, 0]);
  const path = line<{ x: number; y: number | null }>()
    .defined((p) => p.y !== null)
    .x((p) => p.x)
    .y((p) => y(p.y as number));

  const lines = data.entries.map((e) => {
    const pts = steps.map((s) => ({ x: x(s.id) ?? 0, y: valueAt(e, s) }));
    const last = [...pts].reverse().find((p) => p.y !== null);
    // Dashed connector over the defined points only, so a run without a value leaves a visible gap.
    const gaps = path(pts.filter((p) => p.y !== null)) ?? '';
    return { e, pts, d: path(pts) ?? '', gaps, lastY: last ? y(last.y as number) : null };
  });
  const labelled = lines.filter((l) => l.lastY !== null);
  const labelYs = spreadLabels(
    labelled.map((l) => l.lastY as number),
    11,
    0,
    ph,
  );
  const labelY = new Map(labelled.map((l, k) => [l.e, labelYs[k]]));
  const labelChars = Math.max(6, Math.floor((right - 12) / 6.1));
  const stepChars = Math.max(4, Math.floor(pw / Math.max(1, steps.length) / 6.4));

  const colorOf = (i: number) => (hover?.i === i ? tokens['--accent'] : tokens['--muted']);
  const opacityOf = (i: number) => (hover === null || hover.i === i ? 1 : 0.3);

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
        <g transform={`translate(${LEFT},${TOP})`}>
          <AxisLeft
            scale={y}
            plotWidth={pw}
            tokens={tokens}
            label={data.metric?.units}
            plotHeight={ph}
          />
          {steps.map((s) => {
            const sx = x(s.id) ?? 0;
            const lab = displayName(s.label, { max: stepChars });
            return (
              <g key={s.id} transform={`translate(${sx},${ph})`}>
                <text y={16} textAnchor="middle" fontSize={10} fill={tokens['--muted']}>
                  {lab.text}
                  <title>{lab.full}</title>
                </text>
                <path
                  d={markerPath(runMarker(s.colorIndex), 3.5)}
                  transform="translate(0,28)"
                  fill={runColor(tokens, s.colorIndex)}
                />
              </g>
            );
          })}
          {/* Hovered line drawn last so it sits on top. */}
          {[...lines.keys()]
            .sort((a, b) => (a === hover?.i ? 1 : b === hover?.i ? -1 : a - b))
            .map((i) => {
              const l = lines[i];
              const name = displayName(l.e.name);
              const short = displayName(l.e.name, { max: labelChars });
              const isHover = hover?.i === i;
              const ly = labelY.get(l.e);
              const open = () => onOpen(l.e);
              const show = (ev: { clientX: number; clientY: number }) =>
                setHover({
                  i,
                  anchor: {
                    left: ev.clientX,
                    top: ev.clientY,
                    right: ev.clientX,
                    bottom: ev.clientY,
                  },
                });
              return (
                <g key={i} data-experiment={name.full} opacity={opacityOf(i)}>
                  <path
                    d={l.gaps}
                    fill="none"
                    stroke={colorOf(i)}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <path
                    d={l.d}
                    fill="none"
                    stroke={colorOf(i)}
                    strokeWidth={isHover ? TREND_LINE_HOVER_WIDTH : TREND_LINE_WIDTH}
                    strokeLinejoin="round"
                  />
                  {l.pts.map((p, k) =>
                    p.y === null ? null : (
                      <circle
                        key={k}
                        cx={p.x}
                        cy={y(p.y)}
                        r={isHover ? 3.5 : 2.5}
                        fill={colorOf(i)}
                      />
                    ),
                  )}
                  {ly !== undefined && (
                    <text
                      x={pw + 8}
                      y={ly}
                      dy="0.32em"
                      fontSize={10}
                      fill={isHover ? tokens['--accent'] : tokens['--muted']}
                    >
                      {short.text}
                      <title>{short.full}</title>
                    </text>
                  )}
                  <path
                    d={l.gaps}
                    fill="none"
                    stroke={tokens['--panel']}
                    strokeOpacity={0}
                    strokeWidth={10}
                    tabIndex={0}
                    role="button"
                    aria-label={`${name.full}: open in Table`}
                    style={{ cursor: 'pointer', outline: 'none' }}
                    onMouseEnter={show}
                    onMouseLeave={() => setHover(null)}
                    onFocus={(ev) => {
                      const r = ev.currentTarget.getBoundingClientRect();
                      setHover({
                        i,
                        anchor: { left: r.right, top: r.top, right: r.right, bottom: r.top },
                      });
                    }}
                    onBlur={() => setHover(null)}
                    onClick={open}
                    onKeyDown={onActivateKey(open)}
                  />
                </g>
              );
            })}
          {/* Wrapped when the card is narrower than the note; extra lines move it up so the
              fixed-height SVG never clips them. */}
          {(() => {
            const lines = footnoteLines(TREND_FOOTNOTE, width - 8);
            const y0 = ph + 54 - (lines.length - 1) * FOOTNOTE_LINE_PX;
            return (
              <text x={-LEFT + 4} y={y0} fontSize={10} fill={tokens['--faint']}>
                {lines.map((l, i) => (
                  <tspan key={i} x={-LEFT + 4} dy={i === 0 ? 0 : FOOTNOTE_LINE_PX}>
                    {l}
                  </tspan>
                ))}
              </text>
            );
          })()}
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
