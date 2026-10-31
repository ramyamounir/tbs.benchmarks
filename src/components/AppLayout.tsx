import { useEffect, useRef, type ReactNode } from 'react';
import { installKeyboard } from '../state/keyboard';
import { SIDEBAR_DOCKED_MIN_PX, useAppStore } from '../state/store';
import { useMediaQuery } from '../util/useMediaQuery';
import { DisclaimerBanner } from './DisclaimerBanner';
import { DropOverlay } from './DropOverlay';
import { ErrorBoundary } from './ErrorBoundary';
import { Modals } from './Modals';
import { Sidebar } from './Sidebar/Sidebar';
import { StorageBanner } from './StorageBanner';
import { Toasts } from './Toasts';
import { TopBar } from './TopBar';

export type SidebarMode = 'docked' | 'drawer';

/**
 * Top bar (and the disclaimer and storage banners) over the sidebar + scrolling main area; toasts and modals on
 * top. Responsive rules (spec Phase 7): ≥ 1100 px the sidebar is docked (`272px 1fr` grid; the
 * toggle collapses it to 0); below that it is an overlay drawer with a scrim, closed by default,
 * by the scrim and by `Esc` (src/state/keyboard.ts).
 */
export function AppLayout({ children }: { children: ReactNode }) {
  const sidebarOpen = useAppStore((s) => s.ui.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const view = useAppStore((s) => s.ui.view);
  const sidebarMode: SidebarMode = useMediaQuery(`(min-width: ${SIDEBAR_DOCKED_MIN_PX}px)`)
    ? 'docked'
    : 'drawer';
  const drawer = sidebarMode === 'drawer';
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => installKeyboard(), []);

  // Crossing the breakpoint resets the sidebar to that layout's default (docked: shown, drawer:
  // closed) so a docked sidebar never pops up as an overlay after a resize.
  const lastMode = useRef(sidebarMode);
  useEffect(() => {
    if (lastMode.current === sidebarMode) return;
    lastMode.current = sidebarMode;
    setSidebarOpen(sidebarMode === 'docked');
  }, [sidebarMode, setSidebarOpen]);

  // An opened drawer takes focus (so Tab starts inside it); closing returns it to the toggle.
  useEffect(() => {
    if (!drawer || !sidebarOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [drawer, sidebarOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-text">
      <TopBar />
      <DisclaimerBanner />
      <StorageBanner />
      <div
        className={`relative grid min-h-0 flex-1 ${!drawer && sidebarOpen ? 'grid-cols-[272px_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]'}`}
      >
        {!drawer && sidebarOpen && <Sidebar />}
        <main
          id="main-view"
          role="tabpanel"
          aria-labelledby={`view-tab-${view}`}
          className="min-h-0 min-w-0 overflow-auto"
        >
          <ErrorBoundary name="Main view" resetKey={view} className="h-full">
            {children}
          </ErrorBoundary>
        </main>
        {drawer && sidebarOpen && (
          <>
            <div
              aria-hidden="true"
              className="absolute inset-0 z-30 bg-text/30"
              onClick={() => setSidebarOpen(false)}
            />
            <div
              ref={drawerRef}
              tabIndex={-1}
              className="absolute inset-y-0 left-0 z-40 flex max-w-[calc(100vw-48px)] shadow-xl outline-none"
            >
              <Sidebar />
            </div>
          </>
        )}
      </div>
      <Toasts />
      <Modals />
      <DropOverlay />
    </div>
  );
}
