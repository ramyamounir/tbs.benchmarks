import { importConfigFile, MAX_CONFIG_BYTES, toJson, toYaml } from '../config/io';
import type { Config, ConfigIssue } from '../model/types';
import { useAppStore } from '../state/store';
import { displayName } from '../util/displayName';
import { downloadBlob, MIME, safeFileName } from '../util/download';

/**
 * Config file import / export shared by the Start screen, the Config card and the storage banner
 * (spec Phase 3 "Config import rule"). An import with any error is never applied.
 */

export type ImportOutcome =
  { ok: true; warnings: number } | { ok: false; message: string; issues: ConfigIssue[] };

export async function importConfigFromFile(file: File): Promise<ImportOutcome> {
  if (file.size > MAX_CONFIG_BYTES) {
    return { ok: false, message: 'Config file is larger than 1 MB', issues: [] };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, message: 'Could not read the file', issues: [] };
  }
  const result = importConfigFile(text, file.name);
  if (!result.ok) return { ok: false, message: result.message, issues: result.issues };
  const store = useAppStore.getState();
  store.flushSave(); // a pending edit of the current config is written before it is replaced
  store.setConfig(result.config);
  const warnings = result.issues.filter((i) => i.severity === 'warning').length;
  store.pushToast(
    warnings > 0 ? 'warn' : 'info',
    importToastText(file.name, result.config, warnings),
  );
  return { ok: true, warnings };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The import success toast (spec Phase 4b), shared by every import path (Start screen, Config
 * card, drag-anywhere): "Imported configs_repo_wandb.yaml as v2 · 5 groups · 8 metrics", or
 * "Imported <file> with n warnings". Counts come from the imported config; the file name goes
 * through displayName().
 */
export function importToastText(fileName: string, config: Config, warnings: number): string {
  const name = displayName(fileName).text;
  if (warnings > 0) return `Imported ${name} with ${plural(warnings, 'warning', 'warnings')}`;
  const metrics = Object.keys(config.metrics).length;
  return `Imported ${name} as v2 · ${plural(config.groups.length, 'group', 'groups')} · ${plural(metrics, 'metric', 'metrics')}`;
}

export function exportConfig(config: Config, format: 'yaml' | 'json'): void {
  const text = format === 'yaml' ? toYaml(config) : toJson(config);
  const blob = new Blob([text], { type: format === 'yaml' ? MIME.yaml : MIME.json });
  downloadBlob(safeFileName(`${config.name}.${format}`), blob);
}

const TOAST_ISSUES = 3;

/**
 * Drag-anywhere config import (spec Phase 4a): the first dropped config file goes through
 * `importConfigFromFile` (size check, flush, `setConfig` only when it has no error, success toast);
 * a failure is reported as a toast too, since a drop has no inline message area. Never rejects.
 */
export async function importDroppedConfigs(files: File[]): Promise<void> {
  const store = useAppStore.getState();
  const file = files[0];
  if (!file) return;
  const name = displayName(file.name).text;
  if (files.length > 1) {
    store.pushToast('warn', `Only one config can be imported at a time; importing ${name}`);
  }
  const outcome = await importConfigFromFile(file);
  if (outcome.ok) return; // importConfigFromFile has shown the success toast
  const shown = outcome.issues.slice(0, TOAST_ISSUES).map((i) => displayName(i.message).text);
  const more = outcome.issues.length - shown.length;
  const details =
    shown.length > 0 ? ` — ${shown.join('; ')}${more > 0 ? `; and ${more} more` : ''}` : '';
  store.pushToast(
    'error',
    `Could not import ${name}: ${displayName(outcome.message).text}${details}. The current config is unchanged.`,
  );
}
