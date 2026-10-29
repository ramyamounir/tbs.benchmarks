import { useCallback, useEffect, useRef, useState } from 'react';
import { exportConfig } from '../../components/configActions';
import { Button } from '../../components/ui/Button';
import { PanelTabs, TabPanel, type PanelTab } from '../../components/ui/PanelTabs';
import type { ConfigIssue } from '../../model/types';
import { useExperimentCount, useLoadedSources } from '../../state/selectors';
import { useAppStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { useMediaQuery } from '../../util/useMediaQuery';
import { FilesPanel } from './FilesPanel';
import { FOCUS_RING } from './fields';
import { GroupEditor } from './GroupEditor';
import { MetricEditor } from './MetricEditor';
import { useSelectedMetricKey } from './selection';

type ConfigPanel = 'files' | 'group' | 'metric';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Moves the editors to an issue's target (group, metric, experiment's group, chart, files). */
function jumpTo(issue: ConfigIssue): void {
  const s = useAppStore.getState();
  const t = issue.target;
  if (!t) {
    if (issue.code === 'experiments-unassigned') {
      s.setSession({ config: { filesTab: 'experiments', filesFilter: 'unassigned' } });
      document.getElementById('config-files-panel')?.focus();
    }
    return;
  }
  switch (t.kind) {
    case 'group':
      s.setSession({ config: { selectedGroup: t.id, tab: 'groups' } });
      break;
    case 'metric':
      s.setSession({ config: { selectedMetric: t.id, tab: 'metrics' } });
      break;
    case 'experiment': {
      const g = s.config.active.config.groups.find((x) => x.experiments.includes(t.id));
      if (g) s.setSession({ config: { selectedGroup: g.name, tab: 'groups' } });
      else s.setSession({ config: { filesTab: 'experiments', filesFilter: 'all' } });
      break;
    }
    case 'chart':
      s.setSession({ charts: { selected: t.id } });
      s.setView('charts'); // a no-op until a baseline and a run are loaded
      break;
  }
}

/** `✓ valid` / `n issues` / `n warnings` badge; click opens the clickable issue list. */
function ValidityBadge() {
  const issues = useAppStore((s) => s.config.issues);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLButtonElement>('[data-issue]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const [text, tone] =
    errors > 0
      ? [plural(errors, 'issue', 'issues'), 'border-danger text-danger']
      : warnings > 0
        ? [plural(warnings, 'warning', 'warnings'), 'border-warn bg-warn-bg text-warn']
        : ['✓ valid', 'border-transparent bg-accent-bg text-accent'];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={issues.length === 0}
        onClick={() => setOpen(!open)}
        className={`rounded-md border px-2 py-0.5 text-[12px] font-medium whitespace-nowrap ${tone} ${FOCUS_RING}`}
      >
        {errors > 0 && <span aria-hidden="true">× </span>}
        {errors === 0 && warnings > 0 && <span aria-hidden="true">! </span>}
        {text}
        {errors > 0 && warnings > 0 && (
          <span className="text-muted"> · {plural(warnings, 'warning', 'warnings')}</span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Config issues"
          className="absolute top-full right-0 z-30 mt-1 max-h-[60vh] w-[min(420px,90vw)] overflow-y-auto rounded-lg border border-border bg-panel py-1 shadow-lg"
        >
          <ul>
            {issues.map((issue, i) => (
              <li key={i}>
                <button
                  type="button"
                  data-issue=""
                  onClick={() => {
                    jumpTo(issue);
                    setOpen(false);
                  }}
                  className={`flex w-full min-w-0 items-start gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-row-alt ${FOCUS_RING}`}
                >
                  <span
                    aria-hidden="true"
                    className={issue.severity === 'error' ? 'text-danger' : 'text-warn'}
                  >
                    {issue.severity === 'error' ? '×' : '!'}
                  </span>
                  <span className="sr-only">{issue.severity}: </span>
                  <DisplayName
                    value={issue.message}
                    max={200}
                    className="flex-1 whitespace-normal text-text"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * 900–1100 px: the metric editor as a right slide-over over the group editor. `Esc` (when no
 * field consumed it) and the × button close it.
 */
function MetricSlideOver({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (useAppStore.getState().ui.modal !== null) return;
      e.preventDefault(); // keeps src/state/keyboard.ts from also closing the drawer
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Metric editor"
      className="absolute inset-y-0 right-0 z-20 flex w-[min(366px,100%)] min-w-0 flex-col rounded-xl shadow-xl outline-none"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close metric editor"
        title="Close (Esc)"
        className={`absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-panel text-muted hover:bg-row-alt hover:text-text ${FOCUS_RING}`}
      >
        <span aria-hidden="true">×</span>
      </button>
      <div className="grid min-h-0 flex-1">
        <MetricEditor />
      </div>
    </div>
  );
}

const PANEL_TABS: PanelTab<ConfigPanel>[] = [
  { id: 'files', label: 'Files' },
  { id: 'group', label: 'Group' },
  { id: 'metric', label: 'Metric' },
];

/**
 * Config view (spec Phase 4a/4b): header and the Files / Group / Metric panels. Responsive (spec
 * Phase 7): ≥ 1100 px three columns; 900–1100 px two columns with the metric editor as a
 * slide-over opened by selecting a metric; < 900 px one panel at a time behind `PanelTabs`.
 */
export function ConfigView() {
  const config = useAppStore((s) => s.config.active.config);
  const openModal = useAppStore((s) => s.openModal);
  const selectedMetric = useAppStore((s) => s.session.config.selectedMetric);
  const selectedGroup = useAppStore((s) => s.session.config.selectedGroup);
  const filesFilter = useAppStore((s) => s.session.config.filesFilter);
  const metricKey = useSelectedMetricKey();
  const experiments = useExperimentCount();
  const sources = useLoadedSources();
  const wide = useMediaQuery('(min-width: 1100px)');
  const mid = useMediaQuery('(min-width: 900px)');
  const metrics = Object.keys(config.metrics).length;

  const [slideOpen, setSlideOpen] = useState(false);
  const [panel, setPanel] = useState<ConfigPanel>('group');
  // Selecting a metric (sidebar, metric chip, issue link) opens its editor; selecting a group
  // shows the group editor. Tracked as "previous value" state, adjusted during render.
  const [seen, setSeen] = useState({ metric: selectedMetric, group: selectedGroup, filesFilter });
  if (
    seen.metric !== selectedMetric ||
    seen.group !== selectedGroup ||
    seen.filesFilter !== filesFilter
  ) {
    setSeen({ metric: selectedMetric, group: selectedGroup, filesFilter });
    if (seen.filesFilter !== filesFilter) setPanel('files'); // e.g. "Review →" unassigned
    if (seen.group !== selectedGroup && selectedGroup !== null) setPanel('group');
    if (seen.metric !== selectedMetric && selectedMetric !== null) {
      setPanel('metric');
      setSlideOpen(true);
    }
  }
  const closeSlide = useCallback(() => setSlideOpen(false), []);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 p-4 mid:p-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[18px] font-semibold text-text">Config</h1>
        <p className="min-w-0 flex-1 basis-[200px] font-mono text-[12px] text-muted">
          {plural(config.groups.length, 'group', 'groups')} ·{' '}
          {plural(experiments, 'experiment', 'experiments')} ·{' '}
          {plural(metrics, 'metric', 'metrics')} · {plural(sources.length, 'source', 'sources')}
        </p>
        <ValidityBadge />
        {mid && !wide && metricKey !== null && (
          <Button
            variant={slideOpen ? 'secondary' : 'ghost'}
            aria-pressed={slideOpen}
            onClick={() => setSlideOpen(!slideOpen)}
          >
            <span className="flex max-w-[180px] min-w-0 gap-1">
              Metric: <DisplayName value={metricKey} className="font-mono" />
            </span>
          </Button>
        )}
        <Button onClick={() => openModal({ kind: 'generate', step: 1 })}>
          Generate from files…
        </Button>
        <Button variant="primary" onClick={() => exportConfig(config, 'yaml')}>
          Export YAML
        </Button>
      </header>
      {wide ? (
        <div className="grid min-h-[480px] min-w-0 flex-1 grid-cols-[300px_minmax(0,1fr)_366px] gap-4">
          <FilesPanel />
          <GroupEditor />
          <MetricEditor />
        </div>
      ) : mid ? (
        <div className="relative grid min-h-[480px] min-w-0 flex-1 grid-cols-[minmax(240px,300px)_minmax(0,1fr)] gap-4">
          <FilesPanel />
          <GroupEditor />
          {slideOpen && metricKey !== null && <MetricSlideOver onClose={closeSlide} />}
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <PanelTabs<ConfigPanel>
            tabs={PANEL_TABS}
            value={panel}
            onChange={setPanel}
            ariaLabel="Config panels"
            idPrefix="config-panels"
          />
          <TabPanel
            idPrefix="config-panels"
            id={panel}
            className="grid min-h-[480px] min-w-0 flex-1"
          >
            {panel === 'files' ? (
              <FilesPanel />
            ) : panel === 'group' ? (
              <GroupEditor />
            ) : (
              <MetricEditor />
            )}
          </TabPanel>
        </div>
      )}
    </div>
  );
}
