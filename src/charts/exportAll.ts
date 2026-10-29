/*
 * Module-level ref to the mounted Charts view's "export all charts" function (spec Phase 5b
 * "Export all charts (module-level ref)"). PNG export serialises mounted <svg> nodes, which exist
 * only while ChartsView is rendered; the Export modal (Phase 6) reuses this function and never
 * renders charts itself. No React, no DOM access of its own.
 */

export type ExportAllChartsFn = () => Promise<void>;

let current: ExportAllChartsFn | null = null;

export function registerExportAllCharts(fn: ExportAllChartsFn | null): void {
  current = fn;
}

export function getExportAllCharts(): ExportAllChartsFn | null {
  return current;
}
