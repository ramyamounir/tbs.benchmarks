import { runBg } from '../../components/runColor';
import type { Comparison, Source } from '../../model/types';
import { DisplayName } from '../../util/DisplayName';
import { displayName } from '../../util/displayName';

/** One card per visible run: label, full/partial run, coverage bar and verdict counts. */
export function RunCards({
  cmp,
  runs,
  allRuns,
}: {
  cmp: Comparison;
  runs: Source[];
  allRuns: Source[];
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3">
      {runs.map((run) => {
        const stats = cmp.runs.find((r) => r.source.id === run.id);
        if (!stats) return null;
        const { coverage, counts } = stats;
        const pct = coverage.total === 0 ? 0 : (coverage.found / coverage.total) * 100;
        const worse = counts.worse + counts.mismatch;
        return (
          <section
            key={run.id}
            // Rule 3 of the file-derived string task: attributes carry the sanitised full name.
            aria-label={`Run ${displayName(run.label).full}`}
            className="min-w-0 rounded-lg border border-border bg-panel px-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${runBg(allRuns.indexOf(run))}`}
              />
              <DisplayName
                value={run.label}
                className="flex-1 font-mono text-[13px] font-semibold text-text"
              />
              <span
                className={`shrink-0 text-[11px] ${coverage.partial ? 'text-warn' : 'text-faint'}`}
              >
                {coverage.partial ? 'partial run' : 'full run'}
              </span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-row-alt"
              role="img"
              aria-label={`Coverage ${coverage.found} of ${coverage.total} experiments`}
              title={`${coverage.found} of ${coverage.total} experiments found`}
            >
              <div
                className={`h-full ${runBg(allRuns.indexOf(run))}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px]">
              <span className="text-worse">▼ {worse} worse</span>
              <span className="text-better">▲ {counts.better} better</span>
              <span className="text-muted">= {counts.same} same</span>
              <span className="text-faint">— {counts.missing} missing</span>
            </div>
          </section>
        );
      })}
    </div>
  );
}
