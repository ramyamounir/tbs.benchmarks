import { describe, expect, it } from 'vitest';
import { builtinConfig } from '../config/builtin';
import { smallBaseline, smallRun } from '../fixtures/files';
import { memoryStorage } from '../fixtures/memoryStorage';
import { sharedComparison } from './selectors';
import { createAppStore } from './store';

describe('sharedComparison (Phase 7 performance pass)', () => {
  it('returns the cached result for identical inputs and recomputes when one changes', () => {
    const base = smallBaseline();
    const runs = [smallRun()];
    const choices = {};
    const a = sharedComparison(builtinConfig, base, runs, choices);
    expect(sharedComparison(builtinConfig, base, runs, choices)).toBe(a);
    const b = sharedComparison(builtinConfig, base, runs, { x: 1 });
    expect(b).not.toBe(a);
    expect(sharedComparison(builtinConfig, base, [...runs], {})).not.toBe(b);
  });

  it('session-only changes (filters, toggles, tooltips) keep every compare input identical', () => {
    const store = createAppStore(memoryStorage());
    store.setState((s) => ({
      sources: { ...s.sources, baseline: smallBaseline(), runs: [smallRun()] },
    }));
    const pick = () => {
      const s = store.getState();
      return [s.config.active.config, s.sources.baseline, s.sources.runs, s.session.rowChoices];
    };
    const before = pick();
    const s = store.getState();
    s.setSession({ overview: { onlyRegressions: true, cellColor: 'percent' } });
    s.setSession({ table: { filter: 'ycb', chip: 'regressions' } });
    s.setSession({ charts: { selected: null } });
    s.setShortcutsOpen(true);
    s.setSidebarOpen(false);
    s.setView('config');
    pick().forEach((x, i) => expect(x).toBe(before[i]));
  });
});
