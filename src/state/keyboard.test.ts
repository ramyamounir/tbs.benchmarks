import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinConfig } from '../config/builtin';
import { smallBaseline, smallRun } from '../fixtures/files';
import { SHORTCUTS, VIEW_KEYS, onKeyDown, registerTableExpandAll } from './keyboard';
import { initialSession, useAppStore } from './store';

// Node test environment: a minimal KeyboardEvent stand-in (no DOM target, so never "typing").
function press(key: string, init: Partial<KeyboardEvent> = {}) {
  let prevented = false;
  const e = {
    key,
    target: null,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault() {
      prevented = true;
    },
    ...init,
  } as unknown as KeyboardEvent;
  onKeyDown(e);
  return prevented;
}

const initial = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState({
    ui: { ...initial.ui, view: 'overview', modal: null, shortcutsOpen: false, sidebarOpen: true },
    sources: { baseline: null, runs: [], loading: null, errors: [] },
    session: initialSession(),
  });
  useAppStore.getState().setConfig(builtinConfig);
});
afterEach(() => registerTableExpandAll(null));

function loadPair() {
  useAppStore.setState((s) => ({
    sources: { ...s.sources, baseline: smallBaseline(), runs: [smallRun()] },
  }));
}

describe('keyboard map', () => {
  it('1–5 switch views, but not to a disabled one', () => {
    expect(press('4')).toBe(true);
    expect(useAppStore.getState().ui.view).toBe('config');
    expect(press('2')).toBe(false); // Table needs a baseline and a run
    expect(useAppStore.getState().ui.view).toBe('config');
    loadPair();
    for (const [i, view] of VIEW_KEYS.entries()) {
      press(String(i + 1));
      expect(useAppStore.getState().ui.view).toBe(view);
    }
  });

  it('ignores modified keys and keys while a modal is open', () => {
    expect(press('4', { ctrlKey: true })).toBe(false);
    useAppStore.getState().openModal({ kind: 'addRuns' });
    expect(press('4')).toBe(false);
    expect(useAppStore.getState().ui.view).toBe('overview');
  });

  it('never handles "/" (SearchInput owns it)', () => {
    expect(press('/')).toBe(false);
    expect(SHORTCUTS.some((s) => s.keys === '/')).toBe(true);
  });

  it('Esc closes the modal first, then the shortcuts popover, then the drawer', () => {
    const s = () => useAppStore.getState();
    s().openModal({ kind: 'export' });
    s().setShortcutsOpen(true);
    expect(press('Escape')).toBe(true);
    expect(s().ui.modal).toBeNull();
    expect(s().ui.shortcutsOpen).toBe(true);
    press('Escape');
    expect(s().ui.shortcutsOpen).toBe(false);
    // No matchMedia in node → the sidebar counts as a drawer.
    expect(press('Escape')).toBe(true);
    expect(s().ui.sidebarOpen).toBe(false);
    expect(press('Escape')).toBe(false);
  });

  it('? toggles the shortcuts popover', () => {
    press('?');
    expect(useAppStore.getState().ui.shortcutsOpen).toBe(true);
    press('?');
    expect(useAppStore.getState().ui.shortcutsOpen).toBe(false);
  });

  it('[ / ] cycle the saved charts in the Charts view only (wrapping)', () => {
    loadPair();
    const ids = useAppStore.getState().config.active.config.charts.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(press(']')).toBe(false); // Overview
    useAppStore.getState().setView('charts');
    press(']');
    expect(useAppStore.getState().session.charts.selected).toBe(ids[1]);
    press('[');
    press('[');
    expect(useAppStore.getState().session.charts.selected).toBe(ids[ids.length - 1]);
  });

  it('e runs the registered Table expand-all toggle in the Table view only', () => {
    loadPair();
    let calls = 0;
    registerTableExpandAll(() => calls++);
    press('e');
    expect(calls).toBe(0);
    useAppStore.getState().setView('table');
    expect(press('e')).toBe(true);
    expect(calls).toBe(1);
    registerTableExpandAll(null);
    expect(press('e')).toBe(false);
  });
});
