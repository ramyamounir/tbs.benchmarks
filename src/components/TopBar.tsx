import { useAppStore } from '../state/store';
import { Breadcrumb } from './Breadcrumb';
import { ShortcutsPopover } from './ShortcutsPopover';
import { ThemeToggle } from './ThemeToggle';
import { Button } from './ui/Button';
import { ViewTabs } from './ViewTabs';

const LOGO_SRC = `${import.meta.env.BASE_URL}logo.png`;

function SidebarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
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

function ExportIcon() {
  return (
    <svg
      width="16"
      height="16"
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
 * 52 px top bar: sidebar toggle, logo, breadcrumb, view tabs, Add runs…, Export…, shortcuts, theme.
 * Below 900 px "Add runs…" / "Export…" become icon buttons and the tabs scroll (spec Phase 7).
 */
export function TopBar() {
  const sidebarOpen = useAppStore((s) => s.ui.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const openModal = useAppStore((s) => s.openModal);
  const unsaved = useAppStore((s) => s.config.unsaved);
  return (
    <header className="flex h-[52px] min-w-0 shrink-0 items-center gap-2 border-b border-border bg-panel px-3 mid:gap-3 mid:px-4">
      <button
        type="button"
        onClick={toggleSidebar}
        aria-pressed={sidebarOpen}
        aria-controls="app-sidebar"
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border hover:bg-row-alt focus-visible:outline-2 focus-visible:outline-accent ${
          sidebarOpen ? 'bg-panel text-muted' : 'bg-accent-bg text-accent'
        }`}
      >
        <SidebarIcon />
      </button>
      <div className="flex shrink-0 items-center gap-2 max-[420px]:hidden">
        <img src={LOGO_SRC} alt="" width={26} height={26} className="h-[26px] w-[26px]" />
        <h1 className="text-[15px] font-semibold tracking-tight whitespace-nowrap text-brand-navy max-[900px]:hidden">
          TBP Benchmarks
        </h1>
      </div>
      <div className="h-6 w-px shrink-0 bg-border max-[700px]:hidden" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 items-center max-[700px]:hidden">
        <Breadcrumb />
      </div>
      {unsaved && (
        // The breadcrumb (and its "unsaved" badge) is hidden below 700 px; keep the warning visible.
        <span
          title="Not saved in this browser — export the config to keep it"
          className="shrink-0 rounded border border-warn px-1 text-[10px] font-semibold text-warn min-[700px]:hidden"
        >
          unsaved
        </span>
      )}
      <ViewTabs />
      <div className="flex shrink-0 items-center gap-1.5 max-[700px]:ml-auto mid:gap-2">
        <Button
          variant="primary"
          onClick={() => openModal({ kind: 'addRuns' })}
          aria-label="Add runs…"
          title="Add runs…"
          className="max-[900px]:w-8 max-[900px]:px-0"
        >
          <span className="mid:hidden">
            <PlusIcon />
          </span>
          <span className="max-[900px]:hidden">Add runs…</span>
        </Button>
        <Button
          variant="secondary"
          onClick={() => openModal({ kind: 'export' })}
          aria-label="Export…"
          title="Export…"
          className="max-[900px]:w-8 max-[900px]:px-0"
        >
          <span className="mid:hidden">
            <ExportIcon />
          </span>
          <span className="max-[900px]:hidden">Export…</span>
        </Button>
        <ShortcutsPopover />
        <ThemeToggle />
      </div>
    </header>
  );
}
