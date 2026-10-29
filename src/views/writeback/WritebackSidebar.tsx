import { runBg } from '../../components/runColor';
import { SidebarSection } from '../../components/Sidebar/SidebarSection';
import { Radio } from '../../components/ui/Radio';
import { Toggle } from '../../components/ui/Toggle';
import type { Source } from '../../model/types';
import { useAppStore } from '../../state/store';
import { formatSourceDate } from '../../util/dates';
import { DisplayName } from '../../util/DisplayName';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const rowCount = (s: Source) => s.tables.reduce((n, t) => n + t.csv.rows.length, 0);

/** "wandb · 28 runs · Sep 10" / "repo · 7 tables · Sep 10" */
function runMeta(s: Source): string {
  const size =
    s.kind === 'wandb'
      ? plural(rowCount(s), 'run', 'runs')
      : plural(s.tables.length, 'table', 'tables');
  return `${s.kind} · ${size} · ${formatSourceDate(s.date)}`;
}

function GitIcon() {
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
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7M18 11.5c0 3-4 3.5-10 5" />
    </svg>
  );
}

/** Write-back sidebar: run picker, target baseline and the plan options (spec Phase 6). */
export function WritebackSidebar() {
  const runs = useAppStore((s) => s.sources.runs);
  const baseline = useAppStore((s) => s.sources.baseline);
  const wb = useAppStore((s) => s.session.writeback);
  const setSession = useAppStore((s) => s.setSession);
  if (!baseline) return null;
  const repo = baseline.kind === 'repo';

  return (
    <>
      <SidebarSection title="Write values from">
        <div role="radiogroup" aria-label="Write values from" className="flex flex-col gap-2">
          {runs.map((r, i) => (
            <Radio
              key={r.id}
              card
              name="writeback-run"
              checked={wb.runId === r.id}
              onChange={() => setSession({ writeback: { runId: r.id } })}
              label={
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${runBg(i)}`}
                  />
                  <DisplayName value={r.label} className="font-mono" />
                </span>
              }
              description={runMeta(r)}
            />
          ))}
        </div>
      </SidebarSection>
      <SidebarSection title="Into baseline">
        <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-row-alt px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-text">
            <span className="shrink-0 text-muted">
              <GitIcon />
            </span>
            <DisplayName value={baseline.label} className="font-mono" />
          </span>
          <span className="text-[11px] text-muted">
            {repo
              ? 'Download, then replace in your clone'
              : 'Not a benchmarks folder: download single files'}
          </span>
        </div>
      </SidebarSection>
      <SidebarSection title="Options">
        <div className="flex flex-col gap-3">
          <Toggle
            label="Keep cell formatting"
            checked={wb.keepFormatting}
            onChange={(keepFormatting) => setSession({ writeback: { keepFormatting } })}
          />
          <Toggle
            label="Skip metrics within tolerance"
            checked={wb.skipWithinTol}
            onChange={(skipWithinTol) => setSession({ writeback: { skipWithinTol } })}
          />
          <Toggle
            label="Skip episode mismatches"
            checked={wb.skipEpisodeMismatch}
            onChange={(skipEpisodeMismatch) => setSession({ writeback: { skipEpisodeMismatch } })}
          />
          <p className="text-[11px] text-faint">
            {wb.keepFormatting
              ? 'Decimals and % suffix follow each baseline cell.'
              : 'Decimals follow each metric; a % suffix is kept.'}
          </p>
        </div>
      </SidebarSection>
    </>
  );
}
