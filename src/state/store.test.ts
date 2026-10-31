import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtinConfig } from '../config/builtin';
import { CORRUPT_KEY, STORAGE_KEY } from '../config/storage';
import { smallBaseline, smallRun } from '../fixtures/files';
import { v1SmallConfig } from '../fixtures/v1_small.config';
import { emptyConfig, type Config, type SavedConfig, type Source } from '../model/types';
import { MAX_TOASTS, TOAST_INFO_MS, createAppStore, githubRefKey } from './store';
import { memoryStorage, type MemoryStorage } from '../fixtures/memoryStorage';

function source(id: string): Source {
  return { id, label: id, kind: 'wandb', origin: 'local', tables: [], date: null, hidden: false };
}

describe('initial state', () => {
  it('opens on the Overview (Start screen) with the built-in config seeded', () => {
    const s = createAppStore(memoryStorage()).getState();
    expect(s.ui.view).toBe('overview');
    expect(s.ui.modal).toBeNull();
    expect(s.ui.banner).toBeNull();
    expect(s.ui.toasts).toEqual([]);
    expect(s.config.active.name).toBe('tbp-default');
    expect(s.config.saved).toHaveLength(1);
    expect(s.config.unsaved).toBe(false);
    expect(s.sources).toEqual({ baseline: null, runs: [], loading: null, errors: [] });
  });

  it('builds the github ref key', () => {
    expect(githubRefKey('thousandbrainsproject', 'tbp.monty', 'main')).toBe(
      'thousandbrainsproject/tbp.monty@main',
    );
  });
});

describe('setView', () => {
  it('ignores views that need runs until a baseline and a run are loaded', () => {
    const store = createAppStore(memoryStorage());
    for (const v of ['table', 'charts', 'writeback'] as const) {
      store.getState().setView(v);
      expect(store.getState().ui.view).toBe('overview');
    }
    store.getState().setView('config');
    expect(store.getState().ui.view).toBe('config');
  });

  it('enables every view once ready', () => {
    const store = createAppStore(memoryStorage());
    const op = store.getState().beginLoad('auto', 'x');
    store.getState().commitLoad(op.opId, [source('base'), source('run')], []);
    store.getState().setView('charts');
    expect(store.getState().ui.view).toBe('charts');
    store.getState().removeSource('run');
    expect(store.getState().ui.view).toBe('overview');
  });
});

describe('toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('assigns increasing ids and keeps at most MAX_TOASTS, dropping the oldest', () => {
    const store = createAppStore(memoryStorage());
    const ids = Array.from({ length: MAX_TOASTS + 2 }, (_, i) =>
      store.getState().pushToast('warn', `w${i}`),
    );
    expect(ids[0]).toBe('t1');
    expect(ids[1]).toBe('t2');
    const toasts = store.getState().ui.toasts;
    expect(toasts).toHaveLength(MAX_TOASTS);
    expect(toasts[0].text).toBe('w2');
    expect(toasts[MAX_TOASTS - 1].text).toBe(`w${MAX_TOASTS + 1}`);
  });

  it('auto-dismisses only info toasts', () => {
    const store = createAppStore(memoryStorage());
    const info = store.getState().pushToast('info', 'i');
    store.getState().pushToast('warn', 'w');
    store.getState().pushToast('error', 'e');
    vi.advanceTimersByTime(TOAST_INFO_MS - 1);
    expect(store.getState().ui.toasts.map((t) => t.id)).toContain(info);
    vi.advanceTimersByTime(1);
    expect(store.getState().ui.toasts.map((t) => t.kind)).toEqual(['warn', 'error']);
  });

  it('dismissToast removes one toast; unknown id is a no-op', () => {
    const store = createAppStore(memoryStorage());
    const id = store.getState().pushToast('error', 'e');
    const before = store.getState();
    store.getState().dismissToast('nope');
    expect(store.getState()).toBe(before);
    store.getState().dismissToast(id);
    expect(store.getState().ui.toasts).toEqual([]);
  });
});

describe('setSession', () => {
  it('merges sub-slices one level deep', () => {
    const store = createAppStore(memoryStorage());
    store.getState().setSession({ table: { filter: 'ycb' } });
    const t = store.getState().session.table;
    expect(t.filter).toBe('ycb');
    expect(t.chip).toBe('all');
    store.getState().chooseRow('r\u0000benchmarks/a.csv\u0000x', 3);
    expect(store.getState().session.rowChoices).toEqual({ 'r\u0000benchmarks/a.csv\u0000x': 3 });
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 3: load operations, view rules, GitHub ref cache, persistence, edit reconciliation
// ---------------------------------------------------------------------------------------------

function newStore(st = memoryStorage()) {
  return { store: createAppStore(st), st };
}

describe('load operations', () => {
  it('(a) a newer baseline load wins when the older one resolves last', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const A = g().beginLoad('baseline', 'a');
    const B = g().beginLoad('baseline', 'b');
    expect(A.signal.aborted).toBe(true);
    expect(B.signal.aborted).toBe(false);
    const sa = source('sa');
    const sb = source('sb');
    const errA = { file: 'a', message: 'x', reason: 'parse' as const };
    g().commitLoad(B.opId, [sb], []);
    g().commitLoad(A.opId, [sa], [errA]);
    expect(g().sources.baseline).toBe(sb);
    expect(g().sources.errors).not.toContainEqual(errA);
  });

  it('(b) commits in call order: the older baseline commit is discarded', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const A = g().beginLoad('baseline', 'a');
    const B = g().beginLoad('baseline', 'b');
    const sb = source('sb');
    g().commitLoad(A.opId, [source('sa')], []);
    g().commitLoad(B.opId, [sb], []);
    expect(g().sources.baseline).toBe(sb);
  });

  it('(c) unknown and already-committed ids change nothing', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const before = g();
    g().commitLoad(999, [source('s')], []);
    expect(g()).toBe(before);
    const T = g().beginLoad('auto', 'x');
    g().commitLoad(T.opId, [source('s1')], []);
    const after = g();
    g().commitLoad(T.opId, [source('s2')], []);
    expect(g()).toBe(after);
  });

  it("(d) 'auto': the first source becomes the baseline, the rest runs", () => {
    const { store } = newStore();
    const g = () => store.getState();
    const s1 = source('s1');
    const s2 = source('s2');
    const T = g().beginLoad('auto', 'x');
    g().commitLoad(T.opId, [s1, s2], []);
    expect(g().sources.baseline).toBe(s1);
    expect(g().sources.runs).toEqual([s2]);
    const U = g().beginLoad('auto', 'y');
    const s3 = source('s3');
    g().commitLoad(U.opId, [s3], []);
    expect(g().sources.baseline).toBe(s1);
    expect(g().sources.runs).toEqual([s2, s3]);
  });

  it('(e) a 7th run yields max-runs', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const six = Array.from({ length: 6 }, (_, i) => source(`r${i}`));
    g().commitLoad(g().beginLoad('run', 'six').opId, six, []);
    const s7 = source('r7');
    g().commitLoad(g().beginLoad('run', 'r7').opId, [s7], []);
    expect(g().sources.runs).toHaveLength(6);
    expect(g().sources.errors.at(-1)).toMatchObject({ file: s7.label, reason: 'max-runs' });

    const { store: other } = newStore();
    const h = () => other.getState();
    h().commitLoad(
      h().beginLoad('run', 'five').opId,
      Array.from({ length: 5 }, (_, i) => source(`q${i}`)),
      [],
    );
    const three = [source('x1'), source('x2'), source('x3')];
    h().commitLoad(h().beginLoad('run', 'three').opId, three, []);
    expect(
      h()
        .sources.runs.map((r) => r.id)
        .at(-1),
    ).toBe('x1');
    expect(h().sources.runs).toHaveLength(6);
    expect(
      h()
        .sources.errors.filter((e) => e.reason === 'max-runs')
        .map((e) => e.file),
    ).toEqual(['x2', 'x3']);
  });

  it('(f) two overlapping run ops both commit', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const A = g().beginLoad('run', 'a');
    const B = g().beginLoad('run', 'b');
    expect(A.signal.aborted).toBe(false);
    g().commitLoad(B.opId, [source('b')], []);
    g().commitLoad(A.opId, [source('a')], []);
    expect(g().sources.runs.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('(g) loading follows the current pending op', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const A = g().beginLoad('run', 'a');
    const p = (opId: number, label: string, done: number, total: number) => ({
      opId,
      label,
      done,
      total,
      waitUntil: null,
    });
    expect(g().sources.loading).toEqual(p(A.opId, 'a', 0, 0));
    const B = g().beginLoad('run', 'b');
    expect(g().sources.loading?.opId).toBe(B.opId);
    g().reportProgress(A.opId, 1, 3);
    expect(g().sources.loading).toEqual(p(B.opId, 'b', 0, 0));
    g().reportProgress(B.opId, 2, 7);
    expect(g().sources.loading).toEqual(p(B.opId, 'b', 2, 7));
    g().commitLoad(B.opId, [], []);
    expect(g().sources.loading).toEqual(p(A.opId, 'a', 1, 3));
    g().commitLoad(A.opId, [], []);
    expect(g().sources.loading).toBeNull();
  });

  it('(h) a baseline load does not abort a pending run op', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const R = g().beginLoad('run', 'r');
    g().beginLoad('baseline', 'b');
    expect(R.signal.aborted).toBe(false);
    g().commitLoad(R.opId, [source('r')], []);
    expect(g().sources.runs.map((r) => r.id)).toEqual(['r']);
  });

  it('recomputes config.issues on commit and on remove', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const before = g().config.issues;
    g().commitLoad(g().beginLoad('auto', 'x').opId, [smallBaseline(), smallRun()], []);
    expect(g().config.issues).not.toBe(before);
    expect(g().config.issues.some((i) => i.code === 'table-missing')).toBe(true);
    const afterLoad = g().config.issues;
    g().removeSource(g().sources.runs[0].id);
    expect(g().config.issues).not.toBe(afterLoad);
  });
});

describe('view rules', () => {
  function ready() {
    const { store } = newStore();
    const g = () => store.getState();
    g().commitLoad(g().beginLoad('auto', 'x').opId, [source('base'), source('run')], []);
    return g;
  }

  it('adding the first run on overview keeps overview', () => {
    const { store } = newStore();
    const g = () => store.getState();
    g().commitLoad(g().beginLoad('auto', 'x').opId, [source('base')], []);
    g().commitLoad(g().beginLoad('run', 'y').opId, [source('run')], []);
    expect(g().ui.view).toBe('overview');
  });

  it('removing the last run on table returns to overview', () => {
    const g = ready();
    g().setView('table');
    g().removeSource('run');
    expect(g().ui.view).toBe('overview');
  });

  it('removing the baseline on writeback clears the write-back session, keeps the config', () => {
    const g = ready();
    g().setView('writeback');
    g().setSession({ writeback: { runId: 'run', kept: new Set(['run\u0000t\u0000e\u0000c']) } });
    g().chooseRow('run\u0000t\u0000e', 2);
    const config = g().config.active;
    g().removeSource('base');
    expect(g().ui.view).toBe('overview');
    expect(g().sources.baseline).toBeNull();
    expect(g().sources.runs.map((r) => r.id)).toEqual(['run']);
    expect(g().session.writeback.runId).toBeNull();
    expect(g().session.writeback.kept.size).toBe(0);
    expect(g().session.rowChoices).toEqual({});
    expect(g().config.active).toBe(config);
  });

  it('removing a source on config keeps config', () => {
    const g = ready();
    g().setView('config');
    g().removeSource('run');
    expect(g().ui.view).toBe('config');
  });

  it('removing a run drops exactly its rowChoices and kept keys', () => {
    const { store } = newStore();
    const g = () => store.getState();
    g().commitLoad(
      g().beginLoad('auto', 'x').opId,
      [source('base'), source('r1'), source('r10')],
      [],
    );
    g().chooseRow('r1\u0000t\u0000e', 1);
    g().chooseRow('r10\u0000t\u0000e', 2);
    g().setSession({
      writeback: {
        runId: 'r1',
        kept: new Set(['r1\u0000t\u0000e\u0000c', 'r10\u0000t\u0000e\u0000c']),
      },
    });
    g().removeSource('r1');
    expect(g().session.rowChoices).toEqual({ 'r10\u0000t\u0000e': 2 });
    expect([...g().session.writeback.kept]).toEqual(['r10\u0000t\u0000e\u0000c']);
    expect(g().session.writeback.runId).toBeNull();
  });

  it('removeSource, setConfig and selectSavedConfig reset selectedExperiments', () => {
    const g = ready();
    const sel = () => g().setSession({ config: { selectedExperiments: ['a', 'b'] } });
    sel();
    g().removeSource('run');
    expect(g().session.config.selectedExperiments).toEqual([]);
    sel();
    g().setConfig(builtinConfig);
    expect(g().session.config.selectedExperiments).toEqual([]);
    sel();
    g().saveConfigAs('other');
    sel();
    g().selectSavedConfig(g().config.saved[0].id);
    expect(g().session.config.selectedExperiments).toEqual([]);
  });
});

describe('GitHub ref cache', () => {
  const meta = {
    owner: 'o',
    repo: 'r',
    ref: 'main',
    sha: 'a'.repeat(40),
    date: '2026-01-01T00:00:00Z',
  };
  const gh = (): Source => ({ ...source('gh'), origin: 'github', kind: 'repo', meta });

  it('a committed github source fills session.github', () => {
    const { store } = newStore();
    const g = () => store.getState();
    g().commitLoad(g().beginLoad('baseline', 'gh').opId, [gh()], []);
    expect(g().session.github['o/r@main']).toEqual({ sha: meta.sha, date: meta.date });
  });

  it('reportWait sets and clears waitUntil on the pending op; cancelLoad aborts it', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const t = g().beginLoad('run', 'gh');
    g().reportProgress(t.opId, 1, 3);
    g().reportWait(t.opId, 123_456);
    expect(g().sources.loading).toEqual({
      opId: t.opId,
      label: 'gh',
      done: 1,
      total: 3,
      waitUntil: 123_456,
    });
    g().reportWait(t.opId, null);
    expect(g().sources.loading?.waitUntil).toBeNull();
    g().cancelLoad(t.opId);
    expect(t.signal.aborted).toBe(true);
    expect(g().sources.loading).toBeNull();
    g().commitLoad(t.opId, [gh()], []); // ignored: the op is gone
    expect(g().sources.runs).toEqual([]);
    expect(g().session.github).toEqual({});
  });

  it('rememberGithubRef caches a resolved ref before any commit', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const before = g().session;
    g().rememberGithubRef('o', 'r', 'feat/x', { sha: meta.sha, date: meta.date });
    expect(g().session.github['o/r@feat/x']).toEqual({ sha: meta.sha, date: meta.date });
    expect(g().session.github['o/r@main']).toBeUndefined();
    const same = g().session;
    g().rememberGithubRef('o', 'r', 'feat/x', { sha: meta.sha, date: meta.date });
    expect(g().session).toBe(same); // unchanged value → no new state
    expect(before).not.toBe(same);
  });

  it('a discarded commit writes nothing', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const A = g().beginLoad('baseline', 'a');
    g().beginLoad('baseline', 'b');
    g().commitLoad(A.opId, [gh()], []);
    expect(g().session.github).toEqual({});
  });
});

describe('saved-config persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const stored = (st: MemoryStorage) =>
    JSON.parse(st.getItem(STORAGE_KEY) ?? 'null') as {
      activeId: string;
      configs: SavedConfig[];
    };
  const entry = (id: string, name: string, updatedAt = 1): SavedConfig => ({
    id,
    name,
    updatedAt,
    config: { ...emptyConfig(), name },
  });
  const twoEntries = () =>
    memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        version: 1,
        activeId: 'A',
        configs: [entry('A', 'A'), entry('B', 'B')],
      }),
    });
  const rename = (name: string) => (c: Config) => ({ ...c, name });

  it('(1) first visit seeds tbp-default and writes it immediately', () => {
    const st = memoryStorage();
    const store = createAppStore(st);
    expect(store.getState().config.active.name).toBe('tbp-default');
    expect(store.getState().config.active.config.groups).toHaveLength(7);
    const s = stored(st);
    expect(s.configs).toHaveLength(1);
    expect(s.activeId).toBe(store.getState().config.active.id);
  });

  it('(2) restores the active entry and the metas', () => {
    const st = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        version: 1,
        activeId: 'B',
        configs: [entry('A', 'A'), entry('B', 'B')],
      }),
    });
    const s = createAppStore(st).getState();
    expect(s.config.active.id).toBe('B');
    expect(s.config.saved).toEqual([
      { id: 'A', name: 'A', updatedAt: 1 },
      { id: 'B', name: 'B', updatedAt: 1 },
    ]);
    expect(st.setItemCalls).toHaveLength(0);
  });

  it('(3) a corrupt value seeds the built-in and is kept aside', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = memoryStorage({ [STORAGE_KEY]: '{not json' });
    const s = createAppStore(st).getState();
    expect(s.config.active.name).toBe('tbp-default');
    expect(st.getItem(CORRUPT_KEY)).toBe('{not json');
    warn.mockRestore();
  });

  it('(4) edits are debounced into one write', () => {
    const st = twoEntries();
    const store = createAppStore(st);
    for (let i = 0; i < 3; i++) {
      store.getState().updateConfig(rename(`A${i}`));
      vi.advanceTimersByTime(100);
    }
    expect(st.setItemCalls).toHaveLength(0);
    vi.advanceTimersByTime(399);
    expect(st.setItemCalls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(st.setItemCalls.filter((c) => c.key === STORAGE_KEY)).toHaveLength(1);
    expect(stored(st).configs[0].config.name).toBe('A2');
  });

  it('(5) edit A then switch to B within 500 ms persists into A', () => {
    const st = twoEntries();
    const store = createAppStore(st);
    store.getState().updateConfig(rename('A2'));
    vi.advanceTimersByTime(100);
    store.getState().selectSavedConfig('B');
    const check = () => {
      const s = stored(st);
      expect(s.configs.find((c) => c.id === 'A')?.config.name).toBe('A2');
      expect(s.configs.find((c) => c.id === 'B')?.config.name).toBe('B');
      expect(s.activeId).toBe('B');
    };
    check();
    vi.advanceTimersByTime(1_000);
    check();
    expect(store.getState().config.active.id).toBe('B');
  });

  it('(6) edit A then delete A within 500 ms never re-creates A', () => {
    const st = twoEntries();
    const store = createAppStore(st);
    store.getState().updateConfig(rename('A2'));
    vi.advanceTimersByTime(100);
    store.getState().deleteSavedConfig('A');
    vi.advanceTimersByTime(1_000);
    expect(stored(st).configs.some((c) => c.id === 'A')).toBe(false);
    expect(store.getState().config.saved.some((c) => c.id === 'A')).toBe(false);
    expect(store.getState().config.active.id).toBe('B');
  });

  it('(7) deleting the only entry creates a fresh built-in entry', () => {
    const st = memoryStorage();
    const store = createAppStore(st);
    const id = store.getState().config.active.id;
    store.getState().deleteSavedConfig(id);
    const s = store.getState();
    expect(s.config.active.id).not.toBe(id);
    expect(s.config.active.name).toBe('tbp-default');
    expect(stored(st).configs.map((c) => c.id)).toEqual([s.config.active.id]);
  });

  it('(8) saveConfigAs right after an edit keeps the edit in the original', () => {
    const st = twoEntries();
    const store = createAppStore(st);
    store.getState().updateConfig(rename('A2'));
    store.getState().saveConfigAs('copy');
    const s = stored(st);
    expect(s.configs.find((c) => c.id === 'A')?.config.name).toBe('A2');
    const copy = s.configs.find((c) => c.name === 'copy');
    expect(copy).toBeDefined();
    expect(s.activeId).toBe(copy?.id);
    expect(store.getState().config.active.id).toBe(copy?.id);
    store.getState().saveConfigAs('   ');
    expect(store.getState().config.active.id).toBe(copy?.id);
  });

  it('(8b) with 50 entries saveConfigAs keeps 50 and drops the oldest non-active', () => {
    const configs = Array.from({ length: 50 }, (_, i) => entry(`e${i}`, `e${i}`, 100 + i));
    configs[0].updatedAt = 1_000; // e1 is now the oldest
    const st = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ version: 1, activeId: 'e0', configs }),
    });
    const store = createAppStore(st);
    store.getState().saveConfigAs('new');
    const s = store.getState();
    expect(s.config.saved).toHaveLength(50);
    expect(s.config.saved.some((c) => c.id === 'e1')).toBe(false);
    expect(s.config.saved.some((c) => c.id === 'e0')).toBe(true);
    expect(stored(st).configs).toHaveLength(50);
  });

  it('(9) a full quota shows the banner once, until a successful write', () => {
    const st = twoEntries();
    const store = createAppStore(st);
    const g = () => store.getState();
    st.failWith = () => new DOMException('full', 'QuotaExceededError');
    g().updateConfig(rename('A2'));
    vi.advanceTimersByTime(500);
    expect(g().config.unsaved).toBe(true);
    expect(g().ui.banner).toEqual({ kind: 'storage-full' });
    expect(g().config.active.config.name).toBe('A2');
    g().dismissBanner();
    expect(g().ui.banner).toBeNull();
    g().updateConfig(rename('A3'));
    vi.advanceTimersByTime(500);
    expect(g().ui.banner).toBeNull();
    st.failWith = null;
    g().updateConfig(rename('A4'));
    vi.advanceTimersByTime(500);
    expect(g().config.unsaved).toBe(false);
    st.failWith = () => new DOMException('full', 'QuotaExceededError');
    g().updateConfig(rename('A5'));
    vi.advanceTimersByTime(500);
    expect(g().ui.banner).toEqual({ kind: 'storage-full' });
  });

  it('(10) an oversized config is refused and the stored value kept', () => {
    const st = twoEntries();
    const store = createAppStore(st);
    const before = st.getItem(STORAGE_KEY);
    store.getState().updateConfig((c) => ({ ...c, description: 'x'.repeat(600_000) }));
    vi.advanceTimersByTime(500);
    expect(store.getState().ui.banner).toEqual({ kind: 'storage-full' });
    expect(store.getState().config.unsaved).toBe(true);
    expect(st.getItem(STORAGE_KEY)).toBe(before);
  });

  it('(11) a plain Error from setItem → storage-unavailable', () => {
    const st = twoEntries();
    const store = createAppStore(st);
    st.failWith = () => new Error('denied');
    store.getState().updateConfig(rename('A2'));
    vi.advanceTimersByTime(500);
    expect(store.getState().ui.banner).toEqual({ kind: 'storage-unavailable' });
  });

  it('setConfig recomputes issues and validates', () => {
    const { store } = newStore();
    const g = () => store.getState();
    g().commitLoad(g().beginLoad('auto', 'x').opId, [smallBaseline()], []);
    const before = g().config.issues;
    g().setConfig(v1SmallConfig());
    expect(g().config.issues).not.toBe(before);
    expect(g().config.issues.some((i) => i.code === 'table-missing')).toBe(false);
    expect(g().config.active.config.name).toBe('v1-import');
  });

  it('selectSavedConfig with an unknown id is a no-op', () => {
    const { store } = newStore();
    const before = store.getState();
    store.getState().selectSavedConfig('nope');
    expect(store.getState()).toBe(before);
  });

  // ---- Phase 4a saved-config management ----
  it('renameSavedConfig changes only the name (entry and config), never the id, and writes at once', () => {
    const st = twoEntries();
    const store = createAppStore(st);
    store.getState().updateConfig((c) => ({ ...c, description: 'edited' }));
    store.getState().renameSavedConfig('B', '  Bee  ');
    const s = stored(st);
    // The pending edit of A was flushed first, B renamed in place.
    expect(s.configs.find((c) => c.id === 'A')?.config.description).toBe('edited');
    expect(s.configs.map((c) => c.id)).toEqual(['A', 'B']);
    expect(s.configs[1].name).toBe('Bee');
    expect(s.configs[1].config.name).toBe('Bee');
    expect(store.getState().config.saved[1].name).toBe('Bee');
    expect(store.getState().config.active.id).toBe('A');
    // Renaming the active entry renames the active config too; empty names are refused.
    store.getState().renameSavedConfig('A', 'Ay');
    expect(store.getState().config.active.config.name).toBe('Ay');
    store.getState().renameSavedConfig('A', '   ');
    expect(store.getState().config.active.name).toBe('Ay');
    store.getState().renameSavedConfig('A', 'x'.repeat(200));
    expect(store.getState().config.active.name).toHaveLength(120);
    store.getState().renameSavedConfig('nope', 'z');
    expect(stored(st).configs).toHaveLength(2);
  });

  it('duplicateSavedConfig copies the entry (with a pending edit) into a new active entry', () => {
    const st = twoEntries();
    const store = createAppStore(st);
    store.getState().updateConfig((c) => ({ ...c, description: 'pending' }));
    store.getState().duplicateSavedConfig('A');
    const s = stored(st);
    expect(s.configs).toHaveLength(3);
    const copy = s.configs[2];
    expect(copy.id).not.toBe('A');
    expect(copy.name).toBe('A copy');
    expect(copy.config.description).toBe('pending');
    expect(s.activeId).toBe(copy.id);
    expect(s.configs[0].config.description).toBe('pending');
    // The copy is independent of the original.
    store.getState().updateConfig((c) => ({ ...c, description: 'copy only' }));
    vi.advanceTimersByTime(500);
    expect(stored(st).configs[0].config.description).toBe('pending');
  });

  it('newEmptyConfig and resetBuiltinConfig add a new active entry and apply the cap', () => {
    const st = twoEntries();
    const store = createAppStore(st);
    store.getState().newEmptyConfig();
    expect(store.getState().config.active.config).toEqual(emptyConfig());
    expect(stored(st).configs).toHaveLength(3);
    store.getState().resetBuiltinConfig();
    expect(store.getState().config.active.config.groups).toHaveLength(7);
    expect(store.getState().config.active.name).toBe('tbp-default');
    expect(stored(st).configs).toHaveLength(4);
    expect(stored(st).activeId).toBe(store.getState().config.active.id);

    const configs = Array.from({ length: 50 }, (_, i) => entry(`e${i}`, `e${i}`, 100 + i));
    const full = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ version: 1, activeId: 'e5', configs }),
    });
    const capped = createAppStore(full);
    capped.getState().newEmptyConfig();
    expect(capped.getState().config.saved).toHaveLength(50);
    expect(capped.getState().config.saved.some((c) => c.id === 'e0')).toBe(false);
  });

  it('createConfig flushes a pending edit and adds the config as a new active entry', () => {
    const st = twoEntries();
    const store = createAppStore(st);
    store.getState().updateConfig((c) => ({ ...c, description: 'pending' }));
    store.getState().createConfig({ ...v1SmallConfig(), name: 'tbp.monty@main' });
    const s = stored(st);
    expect(s.configs).toHaveLength(3);
    expect(s.configs[0].config.description).toBe('pending');
    const created = s.configs[2];
    expect(created.name).toBe('tbp.monty@main');
    expect(s.activeId).toBe(created.id);
    expect(store.getState().config.active.config.groups).toHaveLength(2);
  });

  it('savedStorageBytes reflects the saved list', () => {
    const store = createAppStore(twoEntries());
    const before = store.getState().savedStorageBytes();
    expect(before).toBeGreaterThan(0);
    store.getState().resetBuiltinConfig();
    expect(store.getState().savedStorageBytes()).toBeGreaterThan(before);
  });
});

describe('config edit reconciliation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const st = memoryStorage();
    const store = createAppStore(st);
    const g = () => store.getState();
    g().setConfig(builtinConfig);
    vi.advanceTimersByTime(1_000);
    st.setItemCalls.length = 0;
    g().setSession({
      config: { selectedMetric: 'rotation_error', selectedGroup: 'ycb_77objs' },
      table: { metrics: new Set(['rotation_error', 'percent_correct']) },
      charts: { selected: 'c1' },
      overview: { groups: new Set(['ycb_77objs']) },
    });
    return { g, st };
  }

  it('renameMetric renames references and selections with one autosave', () => {
    const { g, st } = setup();
    g().renameMetric('rotation_error', 'rot_err');
    const s = g().session;
    expect(s.config.selectedMetric).toBe('rot_err');
    expect(s.table.metrics.has('rot_err')).toBe(true);
    expect(s.table.metrics.has('rotation_error')).toBe(false);
    expect(s.charts.selected).toBe('c1');
    expect(g().config.issues.some((i) => i.code === 'chart-metric-unknown')).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(st.setItemCalls.filter((c) => c.key === STORAGE_KEY)).toHaveLength(1);
  });

  it('deleteMetric clears the selections and the chart', () => {
    const { g } = setup();
    g().deleteMetric('rotation_error');
    const s = g().session;
    expect(s.config.selectedMetric).toBeNull();
    expect(s.table.metrics.has('rotation_error')).toBe(false);
    expect(s.charts.selected).toBeNull();
    expect(g().config.active.config.charts.some((c) => c.id === 'c1')).toBe(false);
  });

  it('renameGroup follows the selection and the overview groups', () => {
    const { g } = setup();
    g().renameGroup('ycb_77objs', 'ycb77');
    const s = g().session;
    expect(s.config.selectedGroup).toBe('ycb77');
    expect([...s.overview.groups]).toEqual(['ycb77']);
  });

  it('deleteGroup clears the selection, the overview group and its chart', () => {
    const { g } = setup();
    g().deleteGroup('ycb_77objs');
    const s = g().session;
    expect(s.config.selectedGroup).toBeNull();
    expect(s.overview.groups.has('ycb_77objs')).toBe(false);
    expect(s.charts.selected).toBeNull();
  });

  it('a refused edit changes nothing and schedules no autosave', () => {
    const { g, st } = setup();
    const before = g();
    g().renameMetric('rotation_error', 'percent_correct');
    expect(g()).toBe(before);
    vi.advanceTimersByTime(1_000);
    expect(st.setItemCalls).toHaveLength(0);
  });

  it('setConfig drops stale selections', () => {
    const { g } = setup();
    g().setConfig(v1SmallConfig());
    const s = g().session;
    expect(s.config.selectedGroup).toBeNull();
    expect(s.config.selectedMetric).toBe('rotation_error');
    expect(s.charts.selected).toBeNull();
    expect(s.overview.groups.size).toBe(0);
    expect([...s.table.metrics].sort()).toEqual(['percent_correct', 'rotation_error']);
  });
});

describe('toasts (Phase 1 cases)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('info disappears after TOAST_INFO_MS, warn stays until dismissed', () => {
    const { store } = newStore();
    const g = () => store.getState();
    const id = g().pushToast('info', 'a');
    expect(g().ui.toasts.some((t) => t.id === id)).toBe(true);
    vi.advanceTimersByTime(TOAST_INFO_MS);
    expect(g().ui.toasts.some((t) => t.id === id)).toBe(false);
    const w = g().pushToast('warn', 'w');
    vi.advanceTimersByTime(60_000);
    expect(g().ui.toasts.some((t) => t.id === w)).toBe(true);
    g().dismissToast(w);
    expect(g().ui.toasts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 6: write-back session reset rules
// ---------------------------------------------------------------------------------------------

describe('write-back session rules', () => {
  function loaded() {
    const { store } = newStore();
    const g = () => store.getState();
    g().commitLoad(
      g().beginLoad('auto', 'x').opId,
      [source('base'), source('r1'), source('r2')],
      [],
    );
    return g;
  }
  const K1 = 'r1\u0000benchmarks/t.csv\u0000e\u0000c';
  const K2 = 'r2\u0000benchmarks/t.csv\u0000e\u0000c';

  it('toggleKept adds and removes a key with a new Set each time', () => {
    const g = loaded();
    const before = g().session.writeback.kept;
    g().toggleKept(K1);
    const after = g().session.writeback.kept;
    expect(after).not.toBe(before);
    expect([...after]).toEqual([K1]);
    g().toggleKept(K1);
    expect(g().session.writeback.kept.size).toBe(0);
  });

  it('switching run keeps the options, fileEnabled and the run-scoped kept keys', () => {
    const g = loaded();
    g().setSession({
      writeback: {
        runId: 'r1',
        keepFormatting: false,
        skipWithinTol: true,
        skipEpisodeMismatch: false,
        fileEnabled: { 'benchmarks/t.csv': false },
      },
    });
    g().toggleKept(K1);
    g().setSession({ writeback: { runId: 'r2' } });
    g().toggleKept(K2);
    g().setSession({ writeback: { runId: 'r1' } });
    const wb = g().session.writeback;
    expect(wb.runId).toBe('r1');
    expect(wb.keepFormatting).toBe(false);
    expect(wb.skipWithinTol).toBe(true);
    expect(wb.skipEpisodeMismatch).toBe(false);
    expect(wb.fileEnabled).toEqual({ 'benchmarks/t.csv': false });
    expect([...wb.kept].sort()).toEqual([K1, K2]);
  });

  it('removing the selected run clears runId and drops only its kept keys', () => {
    const g = loaded();
    g().setSession({ writeback: { runId: 'r1', kept: new Set([K1, K2]) } });
    g().removeSource('r1');
    expect(g().session.writeback.runId).toBeNull();
    expect([...g().session.writeback.kept]).toEqual([K2]);
  });

  it('removing another run keeps the selected run', () => {
    const g = loaded();
    g().setSession({ writeback: { runId: 'r1', kept: new Set([K1, K2]) } });
    g().removeSource('r2');
    expect(g().session.writeback.runId).toBe('r1');
    expect([...g().session.writeback.kept]).toEqual([K1]);
  });

  it('changing the baseline (swap or new load) clears kept', () => {
    const g = loaded();
    g().setSession({ writeback: { runId: 'r1', kept: new Set([K1, K2]) } });
    g().setBaseline('r2');
    expect(g().session.writeback.kept.size).toBe(0);
    expect(g().session.writeback.runId).toBeNull();

    g().setSession({ writeback: { runId: 'r1', kept: new Set([K1]) } });
    g().commitLoad(g().beginLoad('baseline', 'nb').opId, [source('nb')], []);
    expect(g().sources.baseline?.id).toBe('nb');
    expect(g().session.writeback.kept.size).toBe(0);
  });
});
