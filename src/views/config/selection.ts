import type { Config, Group } from '../../model/types';
import type { EditResult } from './model';
import { useAppStore } from '../../state/store';

/*
 * The Config view's effective selections: `session.config.selectedGroup` / `selectedMetric` when
 * they name something in the active config, otherwise the first group / the first metric of that
 * group (so the editors are never empty while the config has groups). The hooks only read; the
 * helpers below write the selection and commit edits.
 */

export function useSelectedGroup(): Group | null {
  const groups = useAppStore((s) => s.config.active.config.groups);
  const selected = useAppStore((s) => s.session.config.selectedGroup);
  return groups.find((g) => g.name === selected) ?? groups[0] ?? null;
}

export function useSelectedMetricKey(): string | null {
  const metrics = useAppStore((s) => s.config.active.config.metrics);
  const selected = useAppStore((s) => s.session.config.selectedMetric);
  const group = useSelectedGroup();
  if (selected !== null && Object.hasOwn(metrics, selected)) return selected;
  const first = group?.metrics.find((k) => Object.hasOwn(metrics, k));
  return first ?? Object.keys(metrics)[0] ?? null;
}

/** Selects a group (and shows the Groups tab of the config sidebar). */
export function selectGroup(name: string): void {
  useAppStore.getState().setSession({ config: { selectedGroup: name } });
}

export function selectMetric(key: string): void {
  useAppStore.getState().setSession({ config: { selectedMetric: key } });
}

/**
 * Applies an edit computed from the current active config through one `updateConfig` (one
 * autosave). Returns the refusal reason or the edit's notice (shown inline), else null.
 */
export function commitEdit(edit: (config: Config) => EditResult): string | null {
  const store = useAppStore.getState();
  const result = edit(store.config.active.config);
  if ('error' in result) return result.error;
  store.updateConfig(() => result.config);
  return result.message ?? null;
}
