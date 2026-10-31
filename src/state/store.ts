import { create } from 'zustand';
import {
  type ConfigIssue,
  type LoadError,
  type LoadProgress,
  type SavedConfig,
  type SavedConfigMeta,
  type Source,
  type Config,
  emptyConfig,
} from '../model/types';
import { builtinConfig } from '../config/builtin';
import * as edit from '../config/edit';
import { validateConfig } from '../config/schema';
import {
  capSaved,
  newSavedId,
  readSaved,
  storageBytes,
  writeSaved,
  MAX_SAVED_NAME,
} from '../config/storage';
import { configIssues } from '../config/validate';
import { readStoredTheme, readSystemPrefersDark, resolveTheme } from '../theme/themeStorage';

/*
 * The single app store (spec Phase 1 "App state"). Later phases only add fields/actions here and
 * never create a parallel store. All reset logic (e.g. what removing the baseline clears) lives in
 * the store, never in components.
 */

export type Theme = 'light' | 'dark' | 'system';
// no 'start': Start renders under 'overview' (Phase 3 "View rules"); initial value 'overview'
export type View = 'overview' | 'table' | 'charts' | 'config' | 'writeback';
export type Modal =
  | { kind: 'generate'; step: 1 | 2 | 3 }
  | { kind: 'addRuns' }
  | { kind: 'github'; role: 'baseline' | 'run' }
  | { kind: 'export' };
export interface UiState {
  view: View;
  sidebarOpen: boolean;
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  modal: null | Modal;
  banner: null | Banner; // set only by the Phase 3 storage wiring ("Saved-config persistence"); initial null
  toasts: Toast[]; // transient notices, oldest first, at most MAX_TOASTS; initial []
  savedOpen: boolean; // the Config card's "Saved (n)" popover (also opened from the Start screen); initial false
  shortcutsOpen: boolean; // the top bar's "?" keyboard-shortcuts popover (Phase 7); initial false
}
/**
 * `name` is set only for a refused write whose too-large entry is not the active one (the banner
 * then names that saved config).
 */
export type Banner = { kind: 'storage-full'; name?: string } | { kind: 'storage-unavailable' };
export type ToastKind = 'info' | 'warn' | 'error';
export interface Toast {
  id: string;
  kind: ToastKind;
  text: string;
}
export const MAX_TOASTS = 5;
export const TOAST_INFO_MS = 6_000; // only 'info' toasts auto-dismiss; 'warn' and 'error' stay until dismissed
export interface SourcesState {
  baseline: Source | null;
  runs: Source[]; // ordered; Source.hidden toggles visibility
  loading: LoadProgress | null; // progress of the most recently begun op that is still pending; null when none is pending
  errors: LoadError[];
}
export type LoadRole = 'baseline' | 'run' | 'auto';
export interface LoadTicket {
  opId: number;
  signal: AbortSignal;
} // returned by beginLoad; the loader passes `signal` to every fetch/read
export const MAX_RUNS = 6;
export interface ConfigState {
  active: SavedConfig;
  saved: SavedConfigMeta[];
  issues: ConfigIssue[];
  unsaved: boolean; // true while the last writeSaved was refused (Phase 3 "Saved-config persistence"); initial false
}
export interface SessionState {
  // never persisted
  overview: {
    groups: Set<string>;
    onlyRegressions: boolean;
    hideWithinTol: boolean;
    includeMissing: boolean;
    cellColor: 'tolerance' | 'percent';
  };
  table: {
    filter: string;
    chip: 'all' | 'regressions' | 'improvements' | 'missing';
    sort: 'config' | 'name' | 'regressions';
    expanded: Set<string>;
    metrics: Set<string>;
  };
  charts: { selected: string | null };
  config: {
    tab: 'groups' | 'metrics' | 'sources';
    selectedGroup: string | null;
    selectedMetric: string | null;
    filesTab: 'experiments' | 'columns';
    filesFilter: 'unassigned' | 'assigned' | 'all';
    selectedExperiments: string[]; // Files panel multi-selection (Phase 4a), experiment names in selection order, no duplicates; initial []
  };
  writeback: {
    runId: string | null;
    keepFormatting: boolean;
    skipWithinTol: boolean;
    skipEpisodeMismatch: boolean;
    kept: Set<string>; // `${runId}\u0000${table}\u0000${exp}\u0000${column}` — scoped to the run (Phase 6 "Kept keys")
    fileEnabled: Record<string, boolean>;
  };
  rowChoices: Record<string, number>; // `${sourceId}\u0000${table}\u0000${experiment}` → chosen table row index (an index into Table.csv.rows, i.e. a value of RowMatch.candidates), never a position in the candidates list (Phase 2a "Duplicates")
  github: Record<string, { sha: string; date: string }>; // resolved-ref cache, key githubRefKey(owner, repo, ref) from validated input; written by commitLoad and by rememberGithubRef as soon as a load resolves its ref (Phase 3 "GitHub ref cache"); initial {}
}

/** `${owner}/${repo}@${ref}`; inputs are already validated by validateGithubInput (Phase 3). */
export function githubRefKey(owner: string, repo: string, ref: string): string {
  return `${owner}/${repo}@${ref}`;
}

/** Shallow patch of one or more session sub-slices (each given sub-slice is merged one level deep). */
export type SessionPatch = {
  [K in keyof SessionState]?: SessionState[K] extends Set<unknown> | unknown[]
    ? SessionState[K]
    : Partial<SessionState[K]>;
};

export interface AppActions {
  setView(view: View): void;
  toggleSidebar(): void;
  /** Phase 7: AppLayout resets it when the layout crosses 1100 px (docked ⇄ drawer). */
  setSidebarOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
  openModal(modal: Modal): void;
  closeModal(): void;
  setTheme(theme: Theme): void;
  setSystemPrefersDark(dark: boolean): void;
  beginLoad(role: LoadRole, label: string): LoadTicket;
  reportProgress(opId: number, done: number, total: number): void;
  /** A retry wait started (epoch ms when it ends) or ended (null) for a pending op. */
  reportWait(opId: number, waitUntil: number | null): void;
  /** Aborts a pending op (its loader resolves with nothing and its commit is ignored). */
  cancelLoad(opId: number): void;
  commitLoad(opId: number, sources: Source[], errors: LoadError[]): void;
  /** Caches a resolved ref before the load finishes, so a failed load does not re-resolve on retry. */
  rememberGithubRef(
    owner: string,
    repo: string,
    ref: string,
    resolved: { sha: string; date: string },
  ): void;
  removeSource(id: string): void;
  setBaseline(id: string): void;
  reorderRuns(ids: string[]): void;
  toggleRunHidden(id: string): void;
  setConfig(config: Config): void;
  updateConfig(mutator: (config: Config) => Config): void;
  selectSavedConfig(id: string): void;
  saveConfigAs(name: string): void;
  deleteSavedConfig(id: string): void;
  /** Phase 4a saved-config management (Phase 3 "Saved-config persistence" flush rule). */
  renameSavedConfig(id: string, name: string): void;
  duplicateSavedConfig(id: string): void;
  newEmptyConfig(): void;
  resetBuiltinConfig(): void;
  /** Phase 4b: adds `config` (validated) as a new saved entry and makes it active (Generate wizard). */
  createConfig(config: Config): void;
  /** Estimated size of the saved list in browser storage (Saved popover footer). */
  savedStorageBytes(): number;
  flushSave(): void;
  dismissBanner(): void;
  pushToast(kind: ToastKind, text: string): string;
  dismissToast(id: string): void;
  setSession(patch: SessionPatch): void;
  clearLoadErrors(): void;
  setSavedOpen(open: boolean): void;
  chooseRow(key: string, rowIndex: number): void;
  /** Phase 6: toggles one run-scoped key of `session.writeback.kept` (a new Set each time). */
  toggleKept(key: string): void;
  renameMetric(oldKey: string, newKey: string): void;
  deleteMetric(key: string): void;
  renameGroup(oldName: string, newName: string): void;
  deleteGroup(name: string): void;
}

export interface AppState extends AppActions {
  ui: UiState;
  sources: SourcesState;
  config: ConfigState;
  session: SessionState;
}

/** `ready` of Phase 3 "View rules (store)": a baseline and at least one run are loaded. */
export function isReady(sources: Pick<SourcesState, 'baseline' | 'runs'>): boolean {
  return sources.baseline !== null && sources.runs.length >= 1;
}

/** Views that need a baseline and at least one run; Overview and Config are always enabled. */
export const NEEDS_RUNS: ReadonlySet<View> = new Set<View>(['table', 'charts', 'writeback']);

export function initialSession(): SessionState {
  return {
    overview: {
      groups: new Set(),
      onlyRegressions: false,
      hideWithinTol: false,
      includeMissing: true,
      cellColor: 'tolerance',
    },
    table: { filter: '', chip: 'all', sort: 'config', expanded: new Set(), metrics: new Set() },
    charts: { selected: null },
    config: {
      tab: 'groups',
      selectedGroup: null,
      selectedMetric: null,
      filesTab: 'experiments',
      filesFilter: 'unassigned',
      selectedExperiments: [],
    },
    writeback: {
      runId: null,
      keepFormatting: true,
      skipWithinTol: false,
      skipEpisodeMismatch: true,
      kept: new Set(),
      fileEnabled: {},
    },
    rowChoices: {},
    github: {},
  };
}

/** Debounce of the whole-list autosave (Phase 3 "Saved-config persistence"). */
export const SAVE_DEBOUNCE_MS = 500;

const metasOf = (list: SavedConfig[]): SavedConfigMeta[] =>
  list.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));

const entryName = (name: string) => name.slice(0, MAX_SAVED_NAME);

/** A fresh saved entry holding the built-in config (first visit, or the last entry deleted). */
function builtinEntry(): SavedConfig {
  const config = validateConfig(builtinConfig).config;
  return { id: newSavedId(), name: entryName(config.name), updatedAt: Date.now(), config };
}

function issuesFor(
  config: Config,
  sources: Pick<SourcesState, 'baseline' | 'runs'>,
): ConfigIssue[] {
  return configIssues(config, { baseline: sources.baseline, runs: sources.runs });
}

/**
 * Below this width the sidebar starts collapsed: it is an overlay drawer there (spec Phase 7
 * "Responsive rules"; the same breakpoint as AppLayout's `useMediaQuery('(min-width: 1100px)')`).
 */
export const SIDEBAR_DOCKED_MIN_PX = 1100;

function initialSidebarOpen(): boolean {
  return typeof window === 'undefined' || window.innerWidth >= SIDEBAR_DOCKED_MIN_PX;
}

interface PendingOp {
  role: LoadRole;
  label: string;
  controller: AbortController;
  progress: LoadProgress;
}

/** Session cleanup when the baseline goes away or is replaced (Phase 3 "View rules (store)"). */
function sessionWithoutBaseline(session: SessionState): SessionState {
  return {
    ...session,
    writeback: { ...session.writeback, runId: null, kept: new Set() },
    rowChoices: {},
  };
}

/** Session cleanup when one run goes away: drop everything keyed by that run id. */
function sessionWithoutRun(session: SessionState, id: string): SessionState {
  const prefix = `${id}\u0000`;
  const rowChoices = Object.fromEntries(
    Object.entries(session.rowChoices).filter(([k]) => !k.startsWith(prefix)),
  );
  const kept = new Set([...session.writeback.kept].filter((k) => !k.startsWith(prefix)));
  return {
    ...session,
    writeback: {
      ...session.writeback,
      runId: session.writeback.runId === id ? null : session.writeback.runId,
      kept,
    },
    rowChoices,
  };
}

function withoutSelectedExperiments(session: SessionState): SessionState {
  return session.config.selectedExperiments.length === 0
    ? session
    : { ...session, config: { ...session.config, selectedExperiments: [] } };
}

/**
 * Stale-id rule of "Config edit reconciliation": selections that name something the config no
 * longer has are cleared, so the session never holds a dangling metric, group or chart id.
 * `overview.groups` holds the groups the user unchecked in the Overview (empty = all shown).
 */
export function reconcileSession(session: SessionState, config: Config): SessionState {
  const groups = new Set(config.groups.map((g) => g.name));
  const has = (k: string) => Object.hasOwn(config.metrics, k);
  const c = session.config;
  const selectedGroup =
    c.selectedGroup !== null && groups.has(c.selectedGroup) ? c.selectedGroup : null;
  const selectedMetric =
    c.selectedMetric !== null && has(c.selectedMetric) ? c.selectedMetric : null;
  const chart = session.charts.selected;
  const selectedChart = chart !== null && config.charts.some((x) => x.id === chart) ? chart : null;
  const overviewGroups = [...session.overview.groups].filter((g) => groups.has(g));
  const tableMetrics = [...session.table.metrics].filter(has);
  const sameOverview = overviewGroups.length === session.overview.groups.size;
  const sameTable = tableMetrics.length === session.table.metrics.size;
  return {
    ...session,
    config:
      selectedGroup === c.selectedGroup && selectedMetric === c.selectedMetric
        ? c
        : { ...c, selectedGroup, selectedMetric },
    charts:
      selectedChart === chart ? session.charts : { ...session.charts, selected: selectedChart },
    overview: sameOverview
      ? session.overview
      : { ...session.overview, groups: new Set(overviewGroups) },
    table: sameTable ? session.table : { ...session.table, metrics: new Set(tableMetrics) },
  };
}

/** `set` with a replaced item, keeping order; returns the same Set when `from` is absent. */
function renameInSet(set: Set<string>, from: string, to: string): Set<string> {
  if (!set.has(from)) return set;
  return new Set([...set].map((x) => (x === from ? to : x)));
}

function dropFromSet(set: Set<string>, item: string): Set<string> {
  if (!set.has(item)) return set;
  const next = new Set(set);
  next.delete(item);
  return next;
}

/**
 * Store factory: tests create isolated stores (with an in-memory `Storage`); the app uses the
 * `useAppStore` singleton below (no argument: `storage.ts` resolves `localStorage` itself). Op
 * bookkeeping, the toast counter, the saved list and the autosave timer live in this closure,
 * never in `AppState`.
 */
export function createAppStore(storage?: Storage) {
  let nextOpId = 1;
  let nextToastId = 1;
  const ops = new Map<number, PendingOp>();
  let systemPrefersDark = readSystemPrefersDark();

  // ---- Saved configs (Phase 3 "Saved-config persistence") ----
  // `savedList` is the single source of truth for writes; `config.saved` mirrors its metas.
  const restored = readSaved(storage);
  let savedList: SavedConfig[];
  let initialActive: SavedConfig;
  const seeded = restored.configs.length === 0;
  if (!seeded) {
    savedList = restored.configs;
    initialActive = savedList.find((c) => c.id === restored.activeId) ?? savedList[0];
  } else {
    initialActive = builtinEntry();
    savedList = [initialActive];
  }
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Progress of the current (largest-id) pending op, or null when none is pending. */
  const currentProgress = (): LoadProgress | null => {
    let best: PendingOp | undefined;
    let bestId = -1;
    for (const [id, op] of ops) {
      if (id > bestId) {
        bestId = id;
        best = op;
      }
    }
    return best ? best.progress : null;
  };

  const store = create<AppState>()((set, get) => {
    const theme = readStoredTheme();

    const dismissToast = (id: string) =>
      set((s) =>
        s.ui.toasts.some((t) => t.id === id)
          ? { ui: { ...s.ui, toasts: s.ui.toasts.filter((t) => t.id !== id) } }
          : s,
      );

    /** Applies the "ready" view rule after a source change (Phase 3 "View rules (store)"). */
    const viewAfter = (ui: UiState, sources: SourcesState): UiState =>
      !isReady(sources) && NEEDS_RUNS.has(ui.view) ? { ...ui, view: 'overview' } : ui;

    const flushSave = () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = null;
      const s = get();
      // Reads the list and the active id as they are now, never a captured copy.
      const result = writeSaved({ activeId: s.config.active.id, configs: savedList }, storage);
      if (result.ok) {
        if (s.config.unsaved) set({ config: { ...s.config, unsaved: false } });
        return;
      }
      let banner = s.ui.banner;
      if (!s.config.unsaved) {
        // Only a saved → unsaved transition raises the banner, so a dismissed banner stays away
        // while the condition persists.
        if (result.reason === 'unavailable') {
          banner = { kind: 'storage-unavailable' };
        } else {
          const other =
            result.reason === 'too-large' &&
            result.id !== undefined &&
            result.id !== s.config.active.id
              ? savedList.find((c) => c.id === result.id)?.name
              : undefined;
          banner =
            other === undefined ? { kind: 'storage-full' } : { kind: 'storage-full', name: other };
        }
      }
      set({ config: { ...s.config, unsaved: true }, ui: { ...s.ui, banner } });
    };

    const scheduleSave = () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      // The callback captures nothing: flushSave reads the current list and active id.
      saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    };

    /**
     * The one path for a changed active config (setConfig, updateConfig and the reference-safe
     * edits): new active entry, in-memory list, issues and the session in one `set`, then one
     * debounced autosave.
     */
    const applyActiveConfig = (
      config: Config,
      session: (s: SessionState, config: Config) => SessionState = (x) => x,
    ) => {
      set((s) => {
        const active: SavedConfig = {
          ...s.config.active,
          name: entryName(config.name),
          updatedAt: Date.now(),
          config,
        };
        savedList = savedList.map((e) => (e.id === active.id ? active : e));
        return {
          config: {
            ...s.config,
            active,
            saved: metasOf(savedList),
            issues: issuesFor(config, s.sources),
          },
          session: session(s.session, config),
        };
      });
      scheduleSave();
    };

    /** Makes `entry` active (list already updated), with the stale-id rule; no write. */
    const activate = (entry: SavedConfig) => {
      set((s) => ({
        config: {
          ...s.config,
          active: entry,
          saved: metasOf(savedList),
          issues: issuesFor(entry.config, s.sources),
        },
        session: reconcileSession(withoutSelectedExperiments(s.session), entry.config),
      }));
    };

    /** Appends a new entry holding `config`, makes it active, caps the list and writes it. */
    const addEntry = (config: Config) => {
      const entry: SavedConfig = {
        id: newSavedId(),
        name: entryName(config.name),
        updatedAt: Date.now(),
        config,
      };
      savedList = capSaved([...savedList, entry], entry.id);
      activate(entry);
      flushSave();
    };

    /** Shared by the four reference-safe edits: refused edit → no state change, no autosave. */
    const applyEdit = (
      next: Config,
      reconcile: (session: SessionState, config: Config) => SessionState,
    ) => {
      if (next === get().config.active.config) return;
      applyActiveConfig(next, (session, config) => {
        const s = reconcile(session, config);
        const chart = s.charts.selected;
        return chart !== null && !config.charts.some((c) => c.id === chart)
          ? { ...s, charts: { ...s.charts, selected: null } }
          : s;
      });
    };

    return {
      ui: {
        view: 'overview',
        sidebarOpen: initialSidebarOpen(),
        theme,
        resolvedTheme: resolveTheme(theme, systemPrefersDark),
        modal: null,
        banner: null,
        toasts: [],
        savedOpen: false,
        shortcutsOpen: false,
      },
      sources: { baseline: null, runs: [], loading: null, errors: [] },
      config: {
        active: initialActive,
        saved: metasOf(savedList),
        issues: issuesFor(initialActive.config, { baseline: null, runs: [] }),
        unsaved: false,
      },
      session: initialSession(),

      // ---- UI ----
      setView(view) {
        const s = get();
        if (s.ui.view === view) return;
        if (NEEDS_RUNS.has(view) && !isReady(s.sources)) return; // disabled tab: no-op
        set({ ui: { ...s.ui, view } });
      },
      toggleSidebar() {
        set((s) => ({ ui: { ...s.ui, sidebarOpen: !s.ui.sidebarOpen } }));
      },
      setSidebarOpen(open) {
        set((s) => (s.ui.sidebarOpen === open ? s : { ui: { ...s.ui, sidebarOpen: open } }));
      },
      setShortcutsOpen(open) {
        set((s) => (s.ui.shortcutsOpen === open ? s : { ui: { ...s.ui, shortcutsOpen: open } }));
      },
      openModal(modal) {
        set((s) => ({ ui: { ...s.ui, modal } }));
      },
      closeModal() {
        set((s) => (s.ui.modal === null ? s : { ui: { ...s.ui, modal: null } }));
      },
      setTheme(next) {
        set((s) => ({
          ui: { ...s.ui, theme: next, resolvedTheme: resolveTheme(next, systemPrefersDark) },
        }));
      },
      setSystemPrefersDark(dark) {
        systemPrefersDark = dark;
        set((s) => {
          const resolvedTheme = resolveTheme(s.ui.theme, dark);
          return resolvedTheme === s.ui.resolvedTheme ? s : { ui: { ...s.ui, resolvedTheme } };
        });
      },
      dismissBanner() {
        set((s) => (s.ui.banner === null ? s : { ui: { ...s.ui, banner: null } }));
      },
      pushToast(kind, text) {
        const id = `t${nextToastId++}`;
        set((s) => {
          const toasts = [...s.ui.toasts, { id, kind, text }];
          while (toasts.length > MAX_TOASTS) toasts.shift();
          return { ui: { ...s.ui, toasts } };
        });
        if (kind === 'info') setTimeout(() => dismissToast(id), TOAST_INFO_MS);
        return id;
      },
      dismissToast,
      setSavedOpen(open) {
        set((s) => (s.ui.savedOpen === open ? s : { ui: { ...s.ui, savedOpen: open } }));
      },

      // ---- Load operations (Phase 1 "Load operations") ----
      beginLoad(role, label) {
        const opId = nextOpId++;
        if (role === 'baseline') {
          for (const [id, op] of ops) {
            if (op.role === 'baseline') {
              op.controller.abort();
              ops.delete(id);
            }
          }
        }
        const controller = new AbortController();
        const progress: LoadProgress = { opId, label, done: 0, total: 0, waitUntil: null };
        ops.set(opId, { role, label, controller, progress });
        set((s) => ({ sources: { ...s.sources, loading: progress } }));
        return { opId, signal: controller.signal };
      },
      reportProgress(opId, done, total) {
        const op = ops.get(opId);
        if (!op) return;
        op.progress = { ...op.progress, done, total };
        if (Math.max(...ops.keys()) === opId) {
          set((s) => ({ sources: { ...s.sources, loading: op.progress } }));
        }
      },
      reportWait(opId, waitUntil) {
        const op = ops.get(opId);
        if (!op || op.progress.waitUntil === waitUntil) return;
        op.progress = { ...op.progress, waitUntil };
        if (Math.max(...ops.keys()) === opId) {
          set((s) => ({ sources: { ...s.sources, loading: op.progress } }));
        }
      },
      cancelLoad(opId) {
        const op = ops.get(opId);
        if (!op) return;
        op.controller.abort();
        ops.delete(opId);
        set((s) => ({ sources: { ...s.sources, loading: currentProgress() } }));
      },
      rememberGithubRef(owner, repo, ref, resolved) {
        const key = githubRefKey(owner, repo, ref);
        set((s) => {
          const cur = s.session.github[key];
          if (cur && cur.sha === resolved.sha && cur.date === resolved.date) return s;
          return { session: { ...s.session, github: { ...s.session.github, [key]: resolved } } };
        });
      },
      commitLoad(opId, incoming, errors) {
        const op = ops.get(opId);
        if (!op) return; // unknown, already committed, or invalidated by a newer baseline op
        ops.delete(opId);
        set((s) => {
          let baseline = s.sources.baseline;
          const runs = [...s.sources.runs];
          const extraErrors: LoadError[] = [];
          let session = s.session;
          const addRun = (src: Source) => {
            if (runs.length < MAX_RUNS) runs.push(src);
            else
              extraErrors.push({
                file: src.label,
                message: 'Only 6 runs can be compared at once; remove a run first',
                reason: 'max-runs',
              });
          };
          incoming.forEach((src, i) => {
            if (op.role === 'baseline' && i === 0) {
              if (baseline !== null) session = sessionWithoutBaseline(session);
              baseline = src;
            } else if (op.role === 'auto' && baseline === null) {
              baseline = src;
            } else {
              addRun(src);
            }
          });
          const github = { ...session.github };
          for (const src of incoming) {
            if (src.origin === 'github' && src.meta) {
              const m = src.meta;
              github[githubRefKey(m.owner, m.repo, m.ref)] = { sha: m.sha, date: m.date };
            }
          }
          const sources: SourcesState = {
            baseline,
            runs,
            loading: currentProgress(),
            errors: [...s.sources.errors, ...errors, ...extraErrors],
          };
          return {
            sources,
            session: { ...session, github },
            config: { ...s.config, issues: issuesFor(s.config.active.config, sources) },
          };
        });
      },
      removeSource(id) {
        set((s) => {
          let sources: SourcesState;
          let session: SessionState;
          if (s.sources.baseline?.id === id) {
            sources = { ...s.sources, baseline: null };
            session = sessionWithoutBaseline(s.session);
          } else if (s.sources.runs.some((r) => r.id === id)) {
            sources = { ...s.sources, runs: s.sources.runs.filter((r) => r.id !== id) };
            session = sessionWithoutRun(s.session, id);
          } else {
            return s;
          }
          return {
            sources,
            session: withoutSelectedExperiments(session),
            ui: viewAfter(s.ui, sources),
            config: { ...s.config, issues: issuesFor(s.config.active.config, sources) },
          };
        });
      },
      setBaseline(id) {
        // Swap roles: the chosen run becomes the baseline, the old baseline takes its place.
        set((s) => {
          const i = s.sources.runs.findIndex((r) => r.id === id);
          if (i < 0) return s;
          const runs = [...s.sources.runs];
          const next = runs[i];
          if (s.sources.baseline) runs[i] = { ...s.sources.baseline, hidden: false };
          else runs.splice(i, 1);
          const sources = { ...s.sources, baseline: { ...next, hidden: false }, runs };
          return {
            sources,
            session: sessionWithoutBaseline(s.session),
            ui: viewAfter(s.ui, sources),
            config: { ...s.config, issues: issuesFor(s.config.active.config, sources) },
          };
        });
      },
      reorderRuns(ids) {
        set((s) => {
          const byId = new Map(s.sources.runs.map((r) => [r.id, r]));
          const ordered = ids.flatMap((id) => {
            const r = byId.get(id);
            byId.delete(id);
            return r ? [r] : [];
          });
          // Runs missing from `ids` keep their relative order at the end.
          return { sources: { ...s.sources, runs: [...ordered, ...byId.values()] } };
        });
      },
      clearLoadErrors() {
        set((s) => (s.sources.errors.length === 0 ? s : { sources: { ...s.sources, errors: [] } }));
      },
      toggleRunHidden(id) {
        set((s) => ({
          sources: {
            ...s.sources,
            runs: s.sources.runs.map((r) => (r.id === id ? { ...r, hidden: !r.hidden } : r)),
          },
        }));
      },

      // ---- Config: validation, issues, autosave, saved configs ----
      setConfig(config) {
        // The same structural boundary as imports (idempotent on an already-valid config).
        const valid = validateConfig(config).config;
        applyActiveConfig(valid, (session, cfg) =>
          reconcileSession(withoutSelectedExperiments(session), cfg),
        );
      },
      updateConfig(mutator) {
        // No validateConfig here (it runs on every keystroke): callers pass structurally valid values.
        applyActiveConfig(mutator(structuredClone(get().config.active.config)));
      },
      selectSavedConfig(id) {
        const entry = savedList.find((c) => c.id === id);
        if (!entry) return;
        flushSave(); // a pending edit of the current entry is written while it is still active
        activate(savedList.find((c) => c.id === id) ?? entry);
        flushSave();
      },
      saveConfigAs(name) {
        const trimmed = entryName(name.trim());
        if (trimmed === '') return;
        flushSave();
        // The copy carries its new name inside the config too, so later edits keep it.
        const config = { ...structuredClone(get().config.active.config), name: trimmed };
        const entry: SavedConfig = {
          id: newSavedId(),
          name: trimmed,
          updatedAt: Date.now(),
          config,
        };
        savedList = capSaved([...savedList, entry], entry.id);
        activate(entry);
        flushSave();
      },
      deleteSavedConfig(id) {
        if (!savedList.some((c) => c.id === id)) return;
        flushSave();
        savedList = savedList.filter((c) => c.id !== id);
        const s = get();
        if (s.config.active.id === id) {
          if (savedList.length === 0) savedList = [builtinEntry()];
          activate(savedList[0]);
        } else {
          set({ config: { ...s.config, saved: metasOf(savedList) } });
        }
        flushSave();
      },
      renameSavedConfig(id, name) {
        const trimmed = entryName(name.trim());
        const entry = savedList.find((c) => c.id === id);
        if (!entry || trimmed === '' || trimmed === entry.name) return;
        flushSave();
        // The config carries the name too (the entry name mirrors config.name on every edit).
        const renamed: SavedConfig = {
          ...entry,
          name: trimmed,
          config: { ...entry.config, name: trimmed },
        };
        savedList = savedList.map((c) => (c.id === id ? renamed : c));
        const s = get();
        if (s.config.active.id === id) activate(renamed);
        else set({ config: { ...s.config, saved: metasOf(savedList) } });
        flushSave();
      },
      duplicateSavedConfig(id) {
        const entry = savedList.find((c) => c.id === id);
        if (!entry) return;
        flushSave();
        // Read again after the flush: the entry may be the active one with a pending edit.
        const source = savedList.find((c) => c.id === id) ?? entry;
        const name = entryName(`${source.name} copy`);
        addEntry({ ...structuredClone(source.config), name });
      },
      newEmptyConfig() {
        flushSave();
        addEntry(emptyConfig());
      },
      resetBuiltinConfig() {
        flushSave();
        addEntry(validateConfig(builtinConfig).config);
      },
      createConfig(config) {
        flushSave();
        addEntry(validateConfig(config).config);
      },
      savedStorageBytes() {
        return storageBytes({ activeId: get().config.active.id, configs: savedList });
      },
      flushSave,

      // ---- Reference-safe config edits (Phase 3 "Config edit reconciliation") ----
      renameMetric(oldKey, newKey) {
        applyEdit(edit.renameMetric(get().config.active.config, oldKey, newKey), (s) => ({
          ...s,
          config:
            s.config.selectedMetric === oldKey ? { ...s.config, selectedMetric: newKey } : s.config,
          table: { ...s.table, metrics: renameInSet(s.table.metrics, oldKey, newKey) },
        }));
      },
      deleteMetric(key) {
        applyEdit(edit.deleteMetric(get().config.active.config, key), (s) => ({
          ...s,
          config:
            s.config.selectedMetric === key ? { ...s.config, selectedMetric: null } : s.config,
          table: { ...s.table, metrics: dropFromSet(s.table.metrics, key) },
        }));
      },
      renameGroup(oldName, newName) {
        applyEdit(edit.renameGroup(get().config.active.config, oldName, newName), (s, config) => {
          const remains = config.groups.some((g) => g.name === oldName);
          return {
            ...s,
            config:
              s.config.selectedGroup === oldName
                ? { ...s.config, selectedGroup: newName }
                : s.config,
            overview: remains
              ? s.overview
              : { ...s.overview, groups: renameInSet(s.overview.groups, oldName, newName) },
          };
        });
      },
      deleteGroup(name) {
        applyEdit(edit.deleteGroup(get().config.active.config, name), (s, config) => {
          const remains = config.groups.some((g) => g.name === name);
          return {
            ...s,
            config:
              s.config.selectedGroup === name ? { ...s.config, selectedGroup: null } : s.config,
            overview: remains
              ? s.overview
              : { ...s.overview, groups: dropFromSet(s.overview.groups, name) },
          };
        });
      },

      // ---- Session ----
      setSession(patch) {
        set((s) => {
          const session = { ...s.session } as Record<string, unknown>;
          for (const [k, v] of Object.entries(patch)) {
            const cur = session[k];
            const isPlainObject =
              cur !== null &&
              typeof cur === 'object' &&
              !(cur instanceof Set) &&
              !Array.isArray(cur) &&
              k !== 'rowChoices' &&
              k !== 'github';
            session[k] = isPlainObject ? { ...(cur as object), ...(v as object) } : v;
          }
          return { session: session as unknown as SessionState };
        });
      },
      toggleKept(key) {
        set((s) => {
          const kept = new Set(s.session.writeback.kept);
          if (kept.has(key)) kept.delete(key);
          else kept.add(key);
          return { session: { ...s.session, writeback: { ...s.session.writeback, kept } } };
        });
      },
      chooseRow(key, rowIndex) {
        set((s) => ({
          session: { ...s.session, rowChoices: { ...s.session.rowChoices, [key]: rowIndex } },
        }));
      },
    };
  });

  // First visit / empty or corrupt storage: the built-in entry is written right away (a corrupt
  // value was already copied aside by readSaved, so nothing is lost).
  if (seeded) store.getState().flushSave();

  // Page lifecycle: a pending autosave is written when the page is hidden or unloaded.
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    const flushPending = () => {
      if (saveTimer !== null) store.getState().flushSave();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPending();
    });
    window.addEventListener('beforeunload', flushPending);
  }

  return store;
}

export const useAppStore = createAppStore();
export type AppStore = typeof useAppStore;
