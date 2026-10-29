/**
 * The single global keyboard handler (spec Phase 7 "Keyboard map", as tbs.models). `/` is NOT
 * handled here: `SearchInput` with `shortcut` owns it, so there is never a second `/` listener.
 * Modals, popovers and tooltips keep their own `Esc` handling while focused; this handler is the
 * fallback when focus is elsewhere.
 */
import { NEEDS_RUNS, SIDEBAR_DOCKED_MIN_PX, isReady, useAppStore, type View } from './store';

/** `1`–`5` → view, in top-bar tab order. */
export const VIEW_KEYS: readonly View[] = ['overview', 'table', 'charts', 'config', 'writeback'];

/** Every shortcut, as documented by the top bar's "?" popover and the README. */
export const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: '1 – 5', action: 'Overview / Table / Charts / Config / Write-back' },
  { keys: '/', action: 'Focus the current filter' },
  { keys: 'Esc', action: 'Close a dialog, drawer, popover or tooltip' },
  { keys: '[  ]', action: 'Previous / next chart (Charts)' },
  { keys: 'e', action: 'Expand / collapse all rows (Table)' },
  { keys: '?', action: 'Show these shortcuts' },
  { keys: '← → Home End', action: 'Move between tabs' },
];

// The Table view registers its "Expand all / Collapse all" toggle while mounted (it owns the
// filtered row list that the toggle applies to).
let tableExpandAll: (() => void) | null = null;
export function registerTableExpandAll(fn: (() => void) | null): void {
  tableExpandAll = fn;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

function sidebarIsDrawer(): boolean {
  return (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function' ||
    !window.matchMedia(`(min-width: ${SIDEBAR_DOCKED_MIN_PX}px)`).matches
  );
}

/** `[` / `]`: select the previous / next saved chart (wraps). False when there is none. */
export function cycleChart(dir: -1 | 1): boolean {
  const s = useAppStore.getState();
  const charts = s.config.active.config.charts;
  const n = charts.length;
  if (n === 0) return false;
  const i = Math.max(
    0,
    charts.findIndex((c) => c.id === s.session.charts.selected),
  );
  const next = charts[(i + dir + n) % n].id;
  s.setSession({ charts: { selected: next } });
  // Chart ids come from the config: compare dataset values instead of building a selector.
  if (typeof document === 'undefined') return true;
  Array.from(document.querySelectorAll<HTMLElement>('[data-chart-id]'))
    .find((el) => el.dataset.chartId === next)
    ?.scrollIntoView?.({ block: 'nearest' });
  return true;
}

function onEscape(): boolean {
  const s = useAppStore.getState();
  if (s.ui.modal !== null) {
    s.closeModal();
    return true;
  }
  if (s.ui.shortcutsOpen) {
    s.setShortcutsOpen(false);
    return true;
  }
  if (s.ui.sidebarOpen && sidebarIsDrawer()) {
    s.setSidebarOpen(false);
    return true;
  }
  return false;
}

export function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (onEscape()) e.preventDefault();
    return;
  }
  if (e.repeat || isTypingTarget(e.target)) return;
  const s = useAppStore.getState();
  if (s.ui.modal !== null) return; // dialogs own the keyboard
  const view = s.ui.view;
  switch (e.key) {
    case '1':
    case '2':
    case '3':
    case '4':
    case '5': {
      const next = VIEW_KEYS[Number(e.key) - 1];
      if (NEEDS_RUNS.has(next) && !isReady(s.sources)) return;
      s.setView(next);
      break;
    }
    case '[':
    case ']':
      if (view !== 'charts' || !cycleChart(e.key === '[' ? -1 : 1)) return;
      break;
    case 'e':
    case 'E':
      if (view !== 'table' || !tableExpandAll) return;
      tableExpandAll();
      break;
    case '?':
      s.setShortcutsOpen(!s.ui.shortcutsOpen);
      break;
    default:
      return;
  }
  e.preventDefault();
}

export function installKeyboard(): () => void {
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
