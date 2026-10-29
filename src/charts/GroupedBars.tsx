import { useState } from 'react';
import type { Bounds } from '../components/ui/tooltipPlacement';
import { displayName } from '../util/displayName';
import { AxisLeft } from './Axis';
import { markBounds, onActivateKey, type ChartProps } from './chartProps';
import { ChartTooltip } from './ChartTooltip';
import { CHART_FONT, runColor, verdictToken } from './colors';
import { barLabel, deltaLabel, type ChartEntry } from './data';
import { groupedBands, linear, MARGINS, valueDomain } from './scales';

const NA_HEIGHT = 18;

/**
 * Grouped bars (spec Phase 5b): x = experiments, one bar per baseline + visible run, value / Δ
 * labels, `n/a` dashed placeholder for a missing value, optional tolerance tick on the baseline bar
 * at ± the experiment's effective tolerance, hovered group highlighted with a `--row-alt` band.
 */
export function GroupedBars({
  chart,
  data,
  width,
  height,
  tokens,
  title,
  svgRef,
  onOpen,
}: ChartProps) {
  const [hover, setHover] = useState<{ i: number; anchor: Bounds } | null>(null);
  const metric = data.metric;
  const m = MARGINS;
  const pw = Math.max(0, width - m.left - m.right);
  const ph = Math.max(0, height - m.top - m.bottom);
  const series = [data.baseline, ...data.runs];
  const { outer, inner } = groupedBands(
    data.entries.map((_, i) => String(i)),
    series.map((s) => s.id),
    pw,
  );
  const values = data.entries.flatMap((e) => [
    e.base,
    ...data.runs.map((r) => e.points[r.id]?.value ?? null),
    ...(chart.options.toleranceBand && e.base !== null && e.effectiveTol
      ? [e.base + e.effectiveTol, e.base - e.effectiveTol]
      : []),
  ]);
  const y = linear(valueDomain(values, chart.options.yFromZero), [ph, 0]);
  const [d0, d1] = y.domain();
  const y0 = y(Math.max(d0, Math.min(d1, 0)));
  const labelChars = Math.max(4, Math.floor(outer.step() / 6.2));
  const bw = inner.bandwidth();
  const showLabels = chart.options.deltaLabels && bw >= 10;

  const bar = (key: string, x: number, v: number | null, fill: string) => {
    if (v === null || !Number.isFinite(v)) {
      return (
        <g key={key}>
          <rect
            x={x + 0.5}
            y={y0 - NA_HEIGHT}
            width={Math.max(0, bw - 1)}
            height={NA_HEIGHT - 0.5}
            fill="none"
            stroke={tokens['--faint']}
            strokeDasharray="3 2"
          />
          {bw >= 14 && (
            <text
              x={x + bw / 2}
              y={y0 - NA_HEIGHT - 4}
              textAnchor="middle"
              fontFamily={CHART_FONT}
              fontSize={9}
              fill={tokens['--faint']}
            >
              n/a
            </text>
          )}
        </g>
      );
    }
    const yv = y(v);
    return (
      <rect
        key={key}
        x={x}
        y={Math.min(yv, y0)}
        width={bw}
        height={Math.max(0.5, Math.abs(y0 - yv))}
        fill={fill}
        rx={1.5}
      />
    );
  };

  const group = (e: ChartEntry, i: number) => {
    const gx = outer(String(i)) ?? 0;
    const name = displayName(e.name);
    const short = displayName(e.name, { max: labelChars });
    const bx = gx + (inner(data.baseline.id) ?? 0);
    const tol = e.effectiveTol;
    const hovered = hover?.i === i;
    return (
      <g key={i} data-experiment={name.full}>
        {hovered && (
          <rect
            x={gx - (outer.step() - outer.bandwidth()) / 2}
            y={-m.top + 4}
            width={outer.step()}
            height={ph + m.top - 4}
            fill={tokens['--row-alt']}
          />
        )}
        {bar('b', bx, e.base, runColor(tokens, -1))}
        {data.runs.map((r) =>
          bar(
            r.id,
            gx + (inner(r.id) ?? 0),
            e.points[r.id]?.value ?? null,
            runColor(tokens, r.colorIndex),
          ),
        )}
        {chart.options.toleranceBand && metric && e.base !== null && tol !== null && tol > 0 && (
          <g stroke={tokens['--text']} strokeWidth={1}>
            {[e.base - tol, e.base + tol].map((v) => (
              <line key={v} x1={bx - 3} x2={bx + bw + 3} y1={y(v)} y2={y(v)} />
            ))}
            <line
              x1={bx + bw / 2}
              x2={bx + bw / 2}
              y1={y(e.base - tol)}
              y2={y(e.base + tol)}
              strokeOpacity={0.5}
            />
          </g>
        )}
        {showLabels && metric && (
          <g fontFamily={CHART_FONT} fontSize={9} textAnchor="middle">
            {e.base !== null && (
              <text x={bx + bw / 2} y={Math.min(y(e.base), y0) - 4} fill={tokens['--muted']}>
                {barLabel(e.base, metric)}
              </text>
            )}
            {data.runs.map((r) => {
              const p = e.points[r.id];
              if (!p || p.value === null || p.verdict === 'missing') return null;
              const x = gx + (inner(r.id) ?? 0) + bw / 2;
              return (
                <text
                  key={r.id}
                  x={x}
                  y={Math.min(y(p.value), y0) - 4}
                  fill={tokens[verdictToken(p.verdict)]}
                >
                  {deltaLabel(p.delta, metric)}
                </text>
              );
            })}
          </g>
        )}
        <text
          x={gx + outer.bandwidth() / 2}
          y={ph + 18}
          textAnchor="middle"
          fontFamily={CHART_FONT}
          fontSize={10}
          fill={hovered ? tokens['--text'] : tokens['--muted']}
          fontWeight={hovered ? 600 : 400}
        >
          {short.text}
          <title>{short.full}</title>
        </text>
        <rect
          x={gx - (outer.step() - outer.bandwidth()) / 2}
          y={0}
          width={outer.step()}
          height={ph + 24}
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
  };

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
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisLeft
            scale={y}
            plotWidth={pw}
            tokens={tokens}
            label={metric?.units}
            plotHeight={ph}
          />
          {data.entries.map(group)}
          <line x1={0} x2={pw} y1={y0} y2={y0} stroke={tokens['--faint']} strokeWidth={1} />
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
