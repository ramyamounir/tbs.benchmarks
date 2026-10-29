import type { LoadError } from '../model/types';
import type { LoadRole } from '../state/store';
import { folderTooLargeError, loadFiles, type LoadInput } from './files';
import { importDroppedConfigs } from '../components/configActions';
import {
  MAX_WALK_DEPTH,
  MAX_WALK_ENTRIES,
  dirDepth,
  isConfigFileName,
  isIgnoredDirName,
} from './limits';
import { runLoad } from './runLoad';

/**
 * Drag-and-drop and file pickers (spec Phase 3). Everything ends in `loadFiles` through `runLoad`,
 * so the picker path and the drop path share `groupFiles`' ignore rules and caps.
 */

type WalkResult = { files: { file: File; path: string }[]; errors: LoadError[] };

const stripSlash = (p: string) => p.replace(/^\/+/, '');

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/**
 * Breadth-first walk of dropped entries ("Folder walk"): never descends into an ignored or too-deep
 * directory, guards against cycles, and stops at MAX_WALK_ENTRIES. Never rejects.
 */
export async function walkEntries(
  roots: FileSystemEntry[],
  signal?: AbortSignal,
): Promise<WalkResult> {
  const files: WalkResult['files'] = [];
  const errors: LoadError[] = [];
  const visited = new Set<string>();
  const queue: FileSystemEntry[] = [...roots];
  let count = 0;
  let firstPath: string | undefined;

  while (queue.length > 0) {
    const entry = queue.shift() as FileSystemEntry;
    if (visited.has(entry.fullPath)) continue;
    visited.add(entry.fullPath);
    if (entry.isDirectory && isIgnoredDirName(entry.name)) continue; // .git costs one entry, not 40,000
    count++;
    if (count > MAX_WALK_ENTRIES) {
      return { files: [], errors: [folderTooLargeError(firstPath ?? stripSlash(entry.fullPath))] };
    }
    firstPath ??= stripSlash(entry.fullPath);

    if (entry.isDirectory) {
      if (dirDepth(`${stripSlash(entry.fullPath)}/x`) > MAX_WALK_DEPTH) continue;
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      try {
        // Chrome returns at most 100 entries per call: read until an empty batch.
        for (;;) {
          if (signal?.aborted) return { files: [], errors: [] };
          const batch = await readBatch(reader);
          if (batch.length === 0) break;
          queue.push(...batch);
        }
      } catch {
        errors.push({
          file: stripSlash(entry.fullPath),
          message: 'Could not read',
          reason: 'parse',
        });
      }
    } else if (entry.isFile) {
      try {
        files.push({
          file: await fileOf(entry as FileSystemFileEntry),
          path: stripSlash(entry.fullPath),
        });
      } catch {
        errors.push({
          file: stripSlash(entry.fullPath),
          message: 'Could not read',
          reason: 'parse',
        });
      }
    }
  }
  if (signal?.aborted) return { files: [], errors: [] };
  return { files, errors };
}

/** Load label shown in the progress pill: the dropped/picked item, or a count. */
function labelOf(names: string[]): string {
  if (names.length === 1) return names[0];
  return `${names.length} items`;
}

/** Loads picked files (file picker or `webkitdirectory` folder picker). */
export function loadPicked(role: LoadRole, input: LoadInput): Promise<void> {
  const items = Array.from(input as ArrayLike<File | { file: File; path: string }>);
  if (items.length === 0) return Promise.resolve();
  const first = items[0];
  const firstPath = 'path' in first ? first.path : first.webkitRelativePath || first.name;
  const top = firstPath.split('/').filter(Boolean)[0] ?? firstPath;
  const names = new Set(
    items.map((it) => {
      const p = 'path' in it ? it.path : it.webkitRelativePath || it.name;
      return p.split('/').filter(Boolean)[0] ?? p;
    }),
  );
  return runLoad(role, labelOf(names.size === 1 ? [top] : [...names]), (signal, onProgress) =>
    loadFiles(input, signal, onProgress),
  );
}

/**
 * Handles a `drop` event's DataTransfer. `webkitGetAsEntry()` must be called synchronously inside
 * the event handler, so the entries are collected first and walked afterwards. Loose files with a
 * config extension (`.yaml` / `.yml` / `.json`) are imported as a config (`importDroppedConfigs`:
 * Phase 3 "Config import rule", applied only when it has no error) instead of going to `loadFiles`;
 * everything else (CSVs, folders) is loaded as before.
 */
export function loadDataTransfer(role: LoadRole, dt: DataTransfer): Promise<void> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) {
    const files = Array.from(dt.files ?? []);
    const configs = files.filter((f) => isConfigFileName(f.name));
    const rest = files.filter((f) => !isConfigFileName(f.name));
    const imported = configs.length > 0 ? importDroppedConfigs(configs) : Promise.resolve();
    return Promise.all([imported, rest.length > 0 ? loadPicked(role, rest) : undefined]).then(
      () => undefined,
    );
  }
  const configEntries = entries.filter((e) => e.isFile && isConfigFileName(e.name));
  const sourceEntries = entries.filter((e) => !(e.isFile && isConfigFileName(e.name)));
  const imported =
    configEntries.length > 0
      ? Promise.all(
          configEntries.map((e) => fileOf(e as FileSystemFileEntry).catch(() => null)),
        ).then((files) => importDroppedConfigs(files.filter((f): f is File => f !== null)))
      : Promise.resolve();
  if (sourceEntries.length === 0) return imported;
  const loaded = runLoad(
    role,
    labelOf(sourceEntries.map((e) => e.name)),
    async (signal, onProgress) => {
      const walked = await walkEntries(sourceEntries, signal);
      if (signal.aborted) return { sources: [], errors: [] };
      const result = await loadFiles(walked.files, signal, onProgress);
      return { sources: result.sources, errors: [...walked.errors, ...result.errors] };
    },
  );
  return Promise.all([imported, loaded]).then(() => undefined);
}

/**
 * Opens a native picker without a rendered `<input>`: `folder` uses `webkitdirectory`. The
 * resulting FileList goes straight to `loadFiles` (via `loadPicked`).
 */
export function openPicker(role: LoadRole, folder: boolean): void {
  pickFiles({ accept: folder ? undefined : '.csv', multiple: true, folder }, (files) => {
    void loadPicked(role, files);
  });
}

/** Generic hidden-input picker, also used for config imports. */
export function pickFiles(
  opts: { accept?: string; multiple?: boolean; folder?: boolean },
  onFiles: (files: File[]) => void,
): void {
  const input = document.createElement('input');
  input.type = 'file';
  if (opts.accept) input.accept = opts.accept;
  input.multiple = opts.multiple ?? false;
  if (opts.folder) input.webkitdirectory = true;
  input.style.display = 'none';
  input.addEventListener(
    'change',
    () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (files.length > 0) onFiles(files);
    },
    { once: true },
  );
  input.addEventListener('cancel', () => input.remove(), { once: true });
  document.body.appendChild(input);
  input.click();
}

/** The drop role of the element under the pointer (`data-drop-role` on sidebar cards). */
export function dropRoleAt(target: EventTarget | null): LoadRole {
  const el = target instanceof Element ? target.closest('[data-drop-role]') : null;
  const role = el?.getAttribute('data-drop-role');
  return role === 'baseline' || role === 'run' ? role : 'auto';
}

/** True when the drag carries files (not text or a run row being reordered). */
export function dragHasFiles(dt: DataTransfer | null): boolean {
  return dt !== null && Array.from(dt.types).includes('Files');
}
