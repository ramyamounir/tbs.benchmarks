import { scaleBand } from 'd3-scale';
import { useState } from 'react';
import type { Bounds } from '../components/ui/tooltipPlacement';
import { displayName } from '../util/displayName';
import { markBounds, onActivateKey, type ChartProps } from './chartProps';
import { ChartTooltip } from './ChartTooltip';
import { CHART_FONT, runColor, verdictToken } from './colors';
import { deltaLabel } from './data';
import { BAR_PADDING, gridColumns, linear, plainTick, tickDecimals, valueDomain } from './scales';

const MIN_PANEL = 170;
const PANEL_H = 128;
const GAP = 12;
const TITLE_H = 18;
const AXIS_W = 34;
const LABEL_H = 12;

/** Height of a small-multiples grid of `count` panels at `width`. */
function smallMultiplesHeight(width: number, count: number): number {
  const cols = gridColumns(Math.max(0, width - AXIS_W), MIN_PANEL, count);
  const rows = Math.max(1, Math.ceil(count / cols));
  return rows * PANEL_H + (rows - 1) * GAP + 8;
}

/**
 * Small multiples (spec Phase 5b): one mini bar panel per experiment (baseline + visible runs),
 * all panels on one shared y scale; y ticks on the first column only.
 */
export function SmallMultiples({ chart, data, width, tokens, title, svgRef, onOpen }: ChartProps) {
  const [hover, setHover] = useState<{ i: number; anchor: Bounds } | null>(null);
  const metric = data.metric;
  const n = data.entries.length;
  const inner = Math.max(0, width - AXIS_W);
  const cols = gridColumns(inner, MIN_PANEL, n);
  const height = smallMultiplesHeight(width, n);
  const pw = Math.max(0, (inner - (cols - 1) * GAP) / cols);
  const plotTop = TITLE_H + LABEL_H;
  const plotH = PANEL_H - plotTop - 6;
  const series = [data.baseline, ...data.runs];
  const xb = scaleBand<string>()
    .domain(series.map((s) => s.id))
    .range([6, Math.max(6, pw - 6)])
    .padding(BAR_PADDING * 2);
  const bw = xb.bandwidth();
  const values = data.entries.flatMap((e) => [
    e.base,
    ...data.runs.map((r) => e.points[r.id]?.value ?? null),
  ]);
  const y = linear(valueDomain(values, chart.options.yFromZero), [plotH, 0]);
  const [d0, d1] = y.domain();
  const y0 = y(Math.max(d0, Math.min(d1, 0)));
  const ticks = y.ticks(3);
  const td = tickDecimals(ticks);
  const nameChars = Math.max(6, Math.floor(pw / 6.2));

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
        {data.entries.map((e, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const px = AXIS_W + col * (pw + GAP);
          const py = row * (PANEL_H + GAP);
          const name = displayName(e.name);
          const short = displayName(e.name, { max: nameChars });
          const isHover = hover?.i === i;
          const tol = e.effectiveTol;
          const bx = xb(data.baseline.id) ?? 0;
          return (
            <g key={i} transform={`translate(${px},${py})`} data-experiment={name.full}>
              <rect
                width={pw}
                height={PANEL_H}
                rx={4}
                fill={isHover ? tokens['--row-alt'] : tokens['--panel']}
                stroke={tokens['--border']}
              />
              <text x={6} y={13} fontSize={10} fill={tokens['--text']}>
                {short.text}
                <title>{short.full}</title>
              </text>
              <g transform={`translate(0,${plotTop})`}>
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={0} x2={pw} y1={y(t)} y2={y(t)} stroke={tokens['--border']} />
                    {col === 0 && (
                      <text
                        x={-6}
                        y={y(t)}
                        dy="0.32em"
                        textAnchor="end"
                        fontSize={9}
                        fill={tokens['--faint']}
                      >
                        {plainTick(t, td)}
                      </text>
                    )}
                  </g>
                ))}
                {series.map((s) => {
                  const v = s.colorIndex < 0 ? e.base : (e.points[s.id]?.value ?? null);
                  const x = xb(s.id) ?? 0;
                  if (v === null || !Number.isFinite(v)) {
                    return (
                      <rect
                        key={s.id}
                        x={x + 0.5}
                        y={y0 - 12}
                        width={Math.max(0, bw - 1)}
                        height={11.5}
                        fill="none"
                        stroke={tokens['--faint']}
                        strokeDasharray="2 2"
                      />
                    );
                  }
                  const yv = y(v);
                  return (
                    <rect
                      key={s.id}
                      x={x}
                      y={Math.min(yv, y0)}
                      width={bw}
                      height={Math.max(0.5, Math.abs(y0 - yv))}
                      fill={runColor(tokens, s.colorIndex)}
                      rx={1}
                    />
                  );
                })}
                {chart.options.toleranceBand && e.base !== null && tol !== null && tol > 0 && (
                  <g stroke={tokens['--text']}>
                    {[e.base - tol, e.base + tol].map((v) => (
                      <line key={v} x1={bx - 2} x2={bx + bw + 2} y1={y(v)} y2={y(v)} />
                    ))}
                  </g>
                )}
                {chart.options.deltaLabels &&
                  metric &&
                  bw >= 16 &&
                  data.runs.map((r) => {
                    const p = e.points[r.id];
                    if (!p || p.value === null || p.verdict === 'missing') return null;
                    return (
                      <text
                        key={r.id}
                        x={(xb(r.id) ?? 0) + bw / 2}
                        y={Math.min(y(p.value), y0) - 3}
                        textAnchor="middle"
                        fontSize={8}
                        fill={tokens[verdictToken(p.verdict)]}
                      >
                        {deltaLabel(p.delta, metric)}
                      </text>
                    );
                  })}
                <line x1={0} x2={pw} y1={y0} y2={y0} stroke={tokens['--faint']} />
              </g>
              <rect
                width={pw}
                height={PANEL_H}
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
