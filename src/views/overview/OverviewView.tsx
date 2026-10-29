import { useMemo } from 'react';
import { Button } from '../../components/ui/Button';
import { useComparison, useExperimentCount, useVisibleRuns } from '../../state/selectors';
import { useAppStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { Heatmap } from './Heatmap';
import { overviewModel } from './model';
import { RunCards } from './RunCards';

function Legend() {
  const sw = 'inline-block h-3 w-3.5 rounded-[2px]';
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted"
      aria-label="Legend"
    >
      <span className="flex items-center gap-1">
        <span className="text-worse">▼ worse</span>
        <span aria-hidden="true" className={`${sw} bg-heat-worse-3`} />
        <span aria-hidden="true" className={`${sw} bg-heat-worse-2`} />
        <span aria-hidden="true" className={`${sw} bg-heat-worse-1`} />
        <span aria-hidden="true" className={`${sw} bg-heat-same`} title="same (within tolerance)" />
        <span aria-hidden="true" className={`${sw} bg-heat-better-1`} />
        <span aria-hidden="true" className={`${sw} bg-heat-better-2`} />
        <span aria-hidden="true" className={`${sw} bg-heat-better-3`} />
        <span className="text-better">better ▲</span>
      </span>
      <span className="flex items-center gap-1">
        <span aria-hidden="true" className={`${sw} border border-dashed border-faint`} />— missing
      </span>
      <span className="flex items-center gap-1">
        <span aria-hidden="true" className={`${sw} border border-warn`} />
        episodes differ
      </span>
      <span>! must match</span>
    </div>
  );
}

/** Overview: header + legend, one card per run, and the verdict heatmap. */
export function OverviewView() {
  const cmp = useComparison();
  const config = useAppStore((s) => s.config.active.config);
  const baseline = useAppStore((s) => s.sources.baseline);
  const allRuns = useAppStore((s) => s.sources.runs);
  const ov = useAppStore((s) => s.session.overview);
  const hiddenMetrics = useAppStore((s) => s.session.table.metrics);
  const setView = useAppStore((s) => s.setView);
  const openModal = useAppStore((s) => s.openModal);
  const runs = useVisibleRuns();
  const experiments = useExperimentCount();
  const model = useMemo(
    () => (cmp ? overviewModel(cmp, config, runs, ov, hiddenMetrics) : null),
    [cmp, config, runs, ov, hiddenMetrics],
  );
  if (!cmp || !model || !baseline) return null;
  const metrics = Object.keys(config.metrics).length;
  const unassigned = new Set(cmp.unassigned.flatMap((u) => u.names)).size;
  const missing = cmp.missing.reduce((n, m) => n + m.names.length, 0);

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 mid:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[17px] font-semibold text-text">
          Overview
          <span className="flex min-w-0 gap-1 font-mono text-[12px] font-normal text-muted">
            {experiments} experiments · {metrics} metrics · baseline{' '}
            <DisplayName value={baseline.label} />
          </span>
        </h2>
        <Legend />
      </header>
      {(unassigned > 0 || missing > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warn bg-warn-bg px-3 py-2 text-[12px] text-warn">
          <span aria-hidden="true">!</span>
          {unassigned > 0 && (
            <span>{unassigned} experiments in the files are not in any group</span>
          )}
          {missing > 0 && <span>{missing} configured experiments have no baseline row</span>}
          <button
            type="button"
            className="font-medium underline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => setView('config')}
          >
            Review →
          </button>
        </div>
      )}
      {config.groups.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border bg-panel p-6 text-[13px] text-muted">
          <p className="font-semibold text-text">This config has no groups</p>
          <p>
            Nothing is compared until experiments are grouped. Generate a config from the loaded
            files (one group per benchmark table), or build groups in the Config view.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => openModal({ kind: 'generate', step: 1 })}>
              Generate from files…
            </Button>
            <Button onClick={() => setView('config')}>Open Config</Button>
          </div>
        </div>
      ) : runs.length === 0 ? (
        <p className="text-[13px] text-muted">
          Every run is hidden. Use the eye toggles in the sidebar.
        </p>
      ) : (
        <>
          <RunCards cmp={cmp} runs={runs} allRuns={allRuns} />
          <Heatmap model={model} config={config} runs={runs} allRuns={allRuns} />
        </>
      )}
    </div>
  );
}
