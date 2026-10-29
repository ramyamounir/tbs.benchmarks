import { useCallback, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DropMenu, type DropMenuItem } from '../components/ui/DropMenu';
import type { ChartDef } from '../model/types';
import { DisplayName } from '../util/DisplayName';
import { type ChartProps } from './chartProps';
import { runColor, type ChartTokens } from './colors';
import { runMarker } from './markers';
import { type ChartData, type ChartEntry, defaultTitle, subtitleParts } from './data';
import { DeltaDots } from './DeltaDots';
import { exportChartPng } from './exportPng';
import { GroupedBars } from './GroupedBars';
import { MarkerIcon } from './MarkerIcon';
import { SmallMultiples } from './SmallMultiples';
import { Trend } from './Trend';
import { useChartSize } from './useChartSize';

/** SVG height of a fixed-height chart in a full-width (1120×390) or half (548×350) card. */
const SVG_HEIGHT = { full: 300, half: 262 } as const;

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
    </svg>
  );
}

function Legend({
  chart,
  data,
  tokens,
}: {
  chart: ChartDef;
  data: ChartData;
  tokens: ChartTokens;
}) {
  const withBaseline = chart.type !== 'delta_dots';
  const markers = chart.type === 'delta_dots' || chart.type === 'trend';
  return (
    <ul
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted"
      aria-label="Legend"
    >
      {withBaseline && (
        <li className="flex items-center gap-1.5">
          <MarkerIcon color={runColor(tokens, -1)} shape={markers ? runMarker(-1) : 'square'} />
          baseline
        </li>
      )}
      {data.runs.map((r) => (
        <li key={r.id} className="flex max-w-[160px] min-w-0 items-center gap-1.5">
          <MarkerIcon
            color={runColor(tokens, r.colorIndex)}
            shape={markers ? runMarker(r.colorIndex) : 'square'}
          />
          <DisplayName value={r.label} />
        </li>
      ))}
    </ul>
  );
}

function Body({
  props,
  kind,
}: {
  props: Omit<ChartProps, 'width' | 'height'>;
  kind: 'full' | 'half';
}) {
  const [ref, width] = useChartSize<HTMLDivElement>();
  const { chart, data } = props;
  let content;
  if (!data.groupFound) {
    content = <Empty>This chart&apos;s group is not in the config.</Empty>;
  } else if (!data.metric) {
    content = <Empty>This chart&apos;s metric is not in the config.</Empty>;
  } else if (!data.metricInGroup) {
    content = <Empty>The group does not compare this metric. Pick another metric.</Empty>;
  } else if (data.entries.length === 0) {
    content = <Empty>No experiments selected. Pick some in the sidebar.</Empty>;
  } else if (data.runs.length === 0) {
    content = <Empty>Every run is hidden. Use the eye toggles in the sidebar.</Empty>;
  } else if (width > 0) {
    const p: ChartProps = { ...props, width, height: SVG_HEIGHT[kind] };
    switch (chart.type) {
      case 'grouped_bars':
        content = <GroupedBars {...p} />;
        break;
      case 'delta_dots':
        content = <DeltaDots {...p} />;
        break;
      case 'small_multiples':
        content = <SmallMultiples {...p} />;
        break;
      case 'trend':
        content = <Trend {...p} />;
        break;
    }
  }
  return (
    <div ref={ref} className="min-w-0">
      {content}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="flex h-[200px] items-center justify-center text-[13px] text-muted">{children}</p>
  );
}

/**
 * Chart card (spec Phase 5b): title, subtitle `group · units · direction · tolerance`, legend,
 * PNG download, `…` menu (duplicate / delete / move), selected ring. Clicking the card selects it.
 */
export function ChartFrame({
  chart,
  data,
  tokens,
  selected,
  full,
  index,
  count,
  svgRef,
  onSelect,
  onOpen,
  onDuplicate,
  onDelete,
  onMove,
}: {
  chart: ChartDef;
  data: ChartData;
  tokens: ChartTokens;
  selected: boolean;
  full: boolean;
  index: number;
  count: number;
  /** Called with this chart's id and its mounted <svg> (null on unmount). */
  svgRef(id: string, el: SVGSVGElement | null): void;
  onSelect(): void;
  onOpen(entry: ChartEntry): void;
  onDuplicate(): void;
  onDelete(): void;
  onMove(delta: -1 | 1): void;
}) {
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = chart.title ?? defaultTitle(chart, data.metric);
  // Stable callback: a new ref function per render would detach/attach (and re-set state) every commit.
  const ref = useCallback(
    (el: SVGSVGElement | null) => {
      svgRef(chart.id, el);
      setSvg(el);
    },
    [svgRef, chart.id],
  );
  const download = () => {
    if (!svg) return;
    setError(null);
    exportChartPng(svg, chart.id).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'PNG export failed'),
    );
  };
  const items: DropMenuItem[] = [
    { key: 'dup', label: 'Duplicate', onSelect: onDuplicate },
    { key: 'up', label: 'Move up', disabled: index === 0, onSelect: () => onMove(-1) },
    { key: 'down', label: 'Move down', disabled: index === count - 1, onSelect: () => onMove(1) },
    { key: 'del', label: 'Delete', onSelect: onDelete },
  ];
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSelect();
    }
  };
  return (
    <article
      data-chart-id={chart.id}
      aria-label={title}
      aria-current={selected || undefined}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-panel p-4 focus-visible:outline-2 focus-visible:outline-accent ${
        full ? 'col-span-full' : ''
      } ${selected ? 'border-accent ring-1 ring-accent' : 'border-border'}`}
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="min-w-0 text-[13px] font-semibold text-text">
            <DisplayName value={title} />
          </h3>
          <p className="flex min-w-0 flex-wrap gap-x-1 font-mono text-[11px] text-muted">
            <DisplayName value={chart.group} />
            {data.metric &&
              subtitleParts(data.metric).map((part, i) => (
                <span key={i} className="flex min-w-0 gap-1">
                  <span aria-hidden="true">·</span>
                  <DisplayName value={part} />
                </span>
              ))}
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <Legend chart={chart} data={data} tokens={tokens} />
          <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Download PNG"
              title="Download PNG"
              disabled={!svg}
              onClick={download}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-row-alt hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
            >
              <DownloadIcon />
            </button>
            <DropMenu
              label="…"
              ariaLabel="Chart actions"
              variant="ghost"
              size="sm"
              align="right"
              items={items}
            />
          </div>
        </div>
      </header>
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
      <Body
        kind={full ? 'full' : 'half'}
        props={{ chart, data, tokens, title, svgRef: ref, onOpen }}
      />
    </article>
  );
}
