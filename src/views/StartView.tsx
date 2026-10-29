import { useState, type ReactNode } from 'react';
import { importConfigFromFile, type ImportOutcome } from '../components/configActions';
import { GithubForm } from '../components/GithubForm';
import { ImportMessage } from '../components/ImportMessage';
import { Button } from '../components/ui/Button';
import { Radio } from '../components/ui/Radio';
import { builtinConfig } from '../config/builtin';
import type { Config } from '../model/types';
import { openPicker, pickFiles } from '../sources/drop';
import { useAppStore } from '../state/store';
import { DisplayName } from '../util/DisplayName';

const STEPS = [
  { title: 'Load', text: 'a baseline and up to 6 runs' },
  { title: 'Configure', text: 'groups, metrics, tolerances' },
  { title: 'Compare', text: 'overview, table, charts, Markdown' },
  { title: 'Write back', text: 'download updated baseline CSVs' },
];

function summary(config: Config): string {
  const experiments = config.groups.reduce((n, g) => n + g.experiments.length, 0);
  const metrics = Object.keys(config.metrics).length;
  return `${config.groups.length} groups · ${experiments} experiments · ${metrics} metrics`;
}

function CardHeader({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-row-alt text-text"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-text">{title}</span>
        <span className="block text-[12px] text-muted">{sub}</span>
      </span>
    </div>
  );
}

const svg = (children: ReactNode) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    {children}
  </svg>
);

function DropCard() {
  const hasBaseline = useAppStore((s) => s.sources.baseline !== null);
  return (
    <section
      aria-label={hasBaseline ? 'Add a run to compare' : 'Drop files here'}
      className="flex min-w-0 flex-col items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-bg px-6 py-8 text-center"
    >
      <span
        aria-hidden="true"
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-panel text-accent"
      >
        {svg(
          <>
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
          </>,
        )}
      </span>
      <h3 className="text-[15px] font-semibold text-text">
        {hasBaseline ? 'Add a run to compare' : 'Drop files here'}
      </h3>
      <p className="mt-2 text-[12px] text-muted">
        wandb CSV exports, benchmark tables, or a whole tbp.monty folder (only benchmarks/*.csv is
        read).
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => openPicker('auto', false)}>
          Choose files…
        </Button>
        <Button onClick={() => openPicker('auto', true)}>Choose folder…</Button>
      </div>
      <p className="mt-6 text-[11px] text-faint">File type is detected from the header</p>
    </section>
  );
}

function LoadedBaseline() {
  const baseline = useAppStore((s) => s.sources.baseline);
  if (baseline === null) return null;
  const rows = baseline.tables.reduce((n, t) => n + t.csv.rows.length, 0);
  return (
    <div className="mb-3 rounded-lg border border-border bg-row-alt px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <DisplayName
          value={baseline.label}
          className="flex-1 font-mono text-[13px] font-semibold"
        />
        <span className="shrink-0 rounded bg-panel px-1.5 py-px text-[10px] font-semibold text-muted">
          BASE
        </span>
      </div>
      <div className="font-mono text-[11px] text-muted">
        {baseline.kind} · {baseline.tables.length} tables · {rows} exps
        {baseline.meta ? ` · ${baseline.meta.sha.slice(0, 7)}` : ''}
      </div>
    </div>
  );
}

function GithubCard() {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-panel p-6">
      <CardHeader
        icon={svg(
          <>
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="18" cy="9" r="2.5" />
            <path d="M6 8.5v7M18 11.5c0 3-4 3.5-10 5" />
          </>,
        )}
        title="Baseline from GitHub"
        sub="Fetches benchmarks/*.csv"
      />
      <LoadedBaseline />
      <GithubForm role="baseline" />
    </section>
  );
}

type Choice = 'builtin' | 'generate' | 'import';

function ConfigChoiceCard() {
  const activeName = useAppStore((s) => s.config.active.config.name);
  const saved = useAppStore((s) => s.config.saved.length);
  const setConfig = useAppStore((s) => s.setConfig);
  const flushSave = useAppStore((s) => s.flushSave);
  const openModal = useAppStore((s) => s.openModal);
  const setSavedOpen = useAppStore((s) => s.setSavedOpen);
  const sidebarOpen = useAppStore((s) => s.ui.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const [choice, setChoice] = useState<Choice>(
    activeName === builtinConfig.name ? 'builtin' : 'import',
  );
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const chooseImport = () =>
    pickFiles({ accept: '.yaml,.yml,.json' }, (files) => {
      void importConfigFromFile(files[0]).then((o) => {
        setOutcome(o);
        if (o.ok) setChoice('import');
      });
    });

  return (
    <section className="min-w-0 rounded-xl border border-border bg-panel p-6">
      <CardHeader
        icon={svg(
          <>
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6" />
          </>,
        )}
        title="Config"
        sub="What to compare and how"
      />
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Config">
        <Radio
          card
          name="start-config"
          checked={choice === 'builtin'}
          onChange={() => {
            flushSave();
            setConfig(builtinConfig);
            setChoice('builtin');
            setOutcome(null);
          }}
          label="Built-in tbp-default"
          description={summary(builtinConfig)}
        />
        <Radio
          card
          name="start-config"
          checked={choice === 'generate'}
          onChange={() => {
            setChoice('generate');
            openModal({ kind: 'generate', step: 1 });
          }}
          label="Generate from files"
          description="Group by benchmark table, match columns"
        />
        <Radio
          card
          name="start-config"
          checked={choice === 'import'}
          onChange={chooseImport}
          label="Import config…"
          description="YAML or JSON; v1 configs are converted"
        />
      </div>
      <ImportMessage outcome={outcome} />
      {saved > 0 && (
        <button
          type="button"
          className="mt-3 w-full text-center text-[12px] font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => {
            if (!sidebarOpen) toggleSidebar();
            setSavedOpen(true);
          }}
        >
          {saved} saved {saved === 1 ? 'config' : 'configs'} in this browser
        </button>
      )}
    </section>
  );
}

/**
 * Start screen, shown under the Overview tab until a baseline and a run are loaded: drop zone,
 * GitHub baseline, config choice and the 4-step strip.
 */
export function StartView() {
  return (
    <div className="mx-auto flex min-h-full max-w-[1030px] flex-col px-4 pt-[8vh] mid:px-6 pb-6">
      <div className="text-center">
        <h2 className="text-[22px] font-semibold text-text">Compare Monty benchmark runs</h2>
        <p className="mt-2 text-[13px] text-muted">
          Load a baseline and one or more runs. Everything is read in your browser.
        </p>
      </div>
      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <DropCard />
        <GithubCard />
        <ConfigChoiceCard />
      </div>
      <ol className="mt-10 grid grid-cols-1 gap-4 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] text-muted"
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-text">{s.title}</span>
              <span className="block text-[12px] text-muted">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-auto pt-12 text-center text-[11px] text-faint">
        Read locally in the browser — nothing is uploaded. Only the config is saved in this browser.
      </p>
    </div>
  );
}
