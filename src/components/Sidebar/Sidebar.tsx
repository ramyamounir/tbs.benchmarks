import { useReady } from '../../state/selectors';
import { useAppStore } from '../../state/store';
import { ChartsSidebar } from '../../views/charts/ChartsSidebar';
import { OverviewSidebar } from '../../views/overview/OverviewSidebar';
import { TableSidebar } from '../../views/table/TableSidebar';
import { WritebackSidebar } from '../../views/writeback/WritebackSidebar';
import { ConfigCard } from './ConfigCard';
import { ConfigSidebar } from './ConfigSidebar';
import { RunsSection } from './RunsSection';

/**
 * Sections per view: Runs everywhere but Config and Write-back (below the chart inspector in
 * Charts), the Config card everywhere but Charts and Write-back; the Config view has its own
 * sidebar (Config card + groups / metrics / sources), Write-back its run picker and options.
 */
function SidebarContent() {
  const view = useAppStore((s) => s.ui.view);
  const ready = useReady();
  switch (view) {
    case 'overview':
      return (
        <>
          <RunsSection />
          {ready && <OverviewSidebar />}
          <ConfigCard />
        </>
      );
    case 'table':
      return (
        <>
          <RunsSection />
          {ready && <TableSidebar />}
          <ConfigCard />
        </>
      );
    case 'charts':
      return (
        <>
          {ready && <ChartsSidebar />}
          <RunsSection />
        </>
      );
    case 'config':
      return <ConfigSidebar />;
    case 'writeback':
      return ready ? (
        <WritebackSidebar />
      ) : (
        <>
          <RunsSection />
          <ConfigCard />
        </>
      );
    default:
      return (
        <>
          <RunsSection />
          <ConfigCard />
        </>
      );
  }
}

/** Left sidebar (272 px, scrollable) with the footer line. Contents depend on the view. */
export function Sidebar() {
  return (
    <aside
      id="app-sidebar"
      aria-label="Sources and options"
      className="flex h-full min-h-0 w-[272px] flex-col border-r border-border bg-panel"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarContent />
      </div>
      <p className="shrink-0 px-4 py-3 text-[11px] text-faint">Files never leave your browser.</p>
    </aside>
  );
}
