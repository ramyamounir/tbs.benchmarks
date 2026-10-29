import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChartFrame } from '../../charts/ChartFrame';
import { buildChartData, type ChartData, type ChartEntry } from '../../charts/data';
import { registerExportAllCharts, type ExportAllChartsFn } from '../../charts/exportAll';
import { exportChartPng, svgToPngBlob } from '../../charts/exportPng';
import { useTokens } from '../../charts/useTokens';
import { Button } from '../../components/ui/Button';
import { experimentKey, useComparison, useVisibleRuns } from '../../state/selectors';
import { useAppStore } from '../../state/store';
import { localDateStamp } from '../../util/dates';
import { downloadBlob, safeFileName } from '../../util/download';
import { zipStore, type ZipEntry } from '../../writeback/zip';
import {
  addChart,
  canAddChart,
  deleteChart,
  duplicateChart,
  effectiveSelected,
  moveChart,
} from './chartActions';

function PlusIcon() {
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
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

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

/**
 * Charts view (spec Phase 5b, reference/03-charts.png): chart cards saved in the config; the
 * selected (default: first) chart is full width, the others in two columns. Chart definitions are
 * edited through `updateConfig` so they export with the config.
 */
export function ChartsView() {
  const cmp = useComparison();
  const config = useAppStore((s) => s.config.active.config);
  const baseline = useAppStore((s) => s.sources.baseline);
  const allRuns = useAppStore((s) => s.sources.runs);
  const selectedRaw = useAppStore((s) => s.session.charts.selected);
  const setSession = useAppStore((s) => s.setSession);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const setView = useAppStore((s) => s.setView);
  const visible = useVisibleRuns();
  const tokens = useTokens();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const selected = effectiveSelected(config, selectedRaw);

  // Mounted <svg> per chart id, for "Export PNG" (spec "Export all charts (module-level ref)").
  const svgs = useRef(new Map<string, SVGSVGElement>());
  // One stable callback for every card (each ChartFrame binds its own id).
  const svgRef = useCallback((id: string, el: SVGSVGElement | null) => {
    if (el) svgs.current.set(id, el);
    else svgs.current.delete(id);
  }, []);

  const exportAllCharts: ExportAllChartsFn = useCallback(async () => {
    const cfg = useAppStore.getState().config.active.config;
    const mounted = cfg.charts
      .map((c) => ({ chart: c, svg: svgs.current.get(c.id) }))
      .filter((x): x is { chart: (typeof x)['chart']; svg: SVGSVGElement } => x.svg !== undefined);
    if (mounted.length === 0) return;
    if (mounted.length === 1) {
      await exportChartPng(mounted[0].svg, mounted[0].chart.id);
      return;
    }
    const entries: ZipEntry[] = [];
    for (const { chart, svg } of mounted) {
      const blob = await svgToPngBlob(svg);
      entries.push({
        name: `chart-${safeFileName(chart.id)}.png`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    const zip = zipStore(entries);
    downloadBlob(safeFileName(`charts-${cfg.name}-${localDateStamp()}.zip`), zip);
  }, []);

  useEffect(() => {
    registerExportAllCharts(exportAllCharts);
    return () => registerExportAllCharts(null);
  }, [exportAllCharts]);

  const datas = useMemo(
    () =>
      new Map<string, ChartData>(
        cmp
          ? config.charts.map((c) => [c.id, buildChartData(cmp, config, c, visible, allRuns)])
          : [],
      ),
    [cmp, config, visible, allRuns],
  );

  const select = useCallback(
    (id: string) => setSession({ charts: { selected: id } }),
    [setSession],
  );
  const open = useCallback(
    (entry: ChartEntry) => {
      const s = useAppStore.getState();
      const expanded = new Set(s.session.table.expanded);
      expanded.add(experimentKey(entry.group, entry.name));
      s.setSession({ table: { expanded } });
      setView('table');
    },
    [setView],
  );

  if (!cmp || !baseline) return null;

  const current = config.charts.find((c) => c.id === selected);
  const newChart = () => {
    const res = addChart(config, current);
    if (!res) return;
    updateConfig(() => res.config);
    select(res.id);
  };
  const exportAll = () => {
    setExportError(null);
    setExporting(true);
    exportAllCharts()
      .catch((e: unknown) => setExportError(e instanceof Error ? e.message : 'PNG export failed'))
      .finally(() => setExporting(false));
  };
  const n = config.charts.length;

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 mid:p-6">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-[17px] font-semibold text-text">
          Charts
          <span className="font-mono text-[12px] font-normal text-muted">
            {n} {n === 1 ? 'chart' : 'charts'} · saved with the config
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {exportError && (
            <span role="alert" className="text-[12px] text-danger">
              {exportError}
            </span>
          )}
          <Button
            onClick={newChart}
            disabled={!canAddChart(config) || config.groups.length === 0}
            title={canAddChart(config) ? undefined : 'Chart limit reached'}
          >
            <PlusIcon />
            New chart
          </Button>
          <Button onClick={exportAll} disabled={n === 0 || exporting}>
            <DownloadIcon />
            Export PNG
          </Button>
        </div>
      </header>
      {n === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border bg-panel p-6 text-[13px] text-muted">
          <p>No charts yet. Charts are saved with the config and exported with it.</p>
          <Button variant="primary" onClick={newChart} disabled={config.groups.length === 0}>
            <PlusIcon />
            New chart
          </Button>
        </div>
      ) : (
        <div className="grid grid-flow-row-dense grid-cols-1 gap-4 wide:grid-cols-2">
          {config.charts.map((chart, i) => (
            <ChartFrame
              key={chart.id}
              chart={chart}
              data={datas.get(chart.id)!}
              tokens={tokens}
              selected={chart.id === selected}
              full={chart.id === selected}
              index={i}
              count={n}
              svgRef={svgRef}
              onSelect={() => select(chart.id)}
              onOpen={open}
              onDuplicate={() => {
                const res = duplicateChart(useAppStore.getState().config.active.config, chart.id);
                if (!res) return;
                updateConfig(() => res.config);
                select(res.id);
              }}
              onDelete={() => updateConfig((c) => deleteChart(c, chart.id))}
              onMove={(d) => updateConfig((c) => moveChart(c, chart.id, d))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
