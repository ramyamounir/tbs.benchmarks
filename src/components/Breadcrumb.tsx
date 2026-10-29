import { useExperimentCount } from '../state/selectors';
import { useAppStore } from '../state/store';
import { DisplayName } from '../util/DisplayName';

const BREADCRUMB_MAX = 48;

function Sep({ children = '›' }: { children?: string }) {
  return (
    <span className="shrink-0 text-faint select-none" aria-hidden="true">
      {children}
    </span>
  );
}

/** `config › <name> · <n> experiments`, computed from the active config. */
export function Breadcrumb() {
  const name = useAppStore((s) => s.config.active.config.name);
  const count = useExperimentCount();
  const unsaved = useAppStore((s) => s.config.unsaved);
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1.5 font-mono text-[13px] text-text"
    >
      <span className="shrink-0 font-sans text-muted max-[1100px]:hidden">config</span>
      <span className="flex shrink-0 max-[1100px]:hidden">
        <Sep />
      </span>
      <DisplayName value={name} max={BREADCRUMB_MAX} className="shrink rounded bg-row-alt px-1.5" />
      {unsaved && (
        <span
          title="Not saved in this browser — export the config to keep it"
          className="shrink-0 rounded border border-warn px-1 font-sans text-[10px] font-semibold text-warn"
        >
          unsaved
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1.5 max-[1280px]:hidden">
        <Sep>·</Sep>
        <span className="text-muted">
          {count} {count === 1 ? 'experiment' : 'experiments'}
        </span>
      </span>
    </nav>
  );
}
