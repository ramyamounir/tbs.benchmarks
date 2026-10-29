import { buildSource, type SourceFile } from '../model/source';
import type { LoadError, Source } from '../model/types';
import {
  MAX_CSV_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_WALK_DEPTH,
  MAX_WALK_ENTRIES,
  dirDepth,
  isIgnoredPath,
  pathSegments,
} from './limits';

/**
 * Local files → sources (spec Phase 3 "Load limits"). `groupFiles` is the single place where the
 * ignore rules, the candidate filter and the caps are applied, for the file picker, the folder
 * picker and the drop walker alike; `loadFiles` reads only what it returns. Nothing here throws.
 */

export interface FileGroup {
  label: string;
  folder: boolean;
  entries: { index: number; path: string; size: number }[];
}

export const FOLDER_TOO_LARGE = 'Folder too large — drop the benchmarks folder instead';

const isCsv = (path: string) => path.toLowerCase().endsWith('.csv');

/** The step-2 error, shared with the drop walker so both report the same thing. */
export function folderTooLargeError(firstPath: string | undefined): LoadError {
  const segs = firstPath === undefined ? [] : pathSegments(firstPath);
  return {
    file: segs.length >= 2 ? segs[0] : 'drop',
    message: FOLDER_TOO_LARGE,
    reason: 'too-many',
  };
}

export function groupFiles(entries: { path: string; size: number }[]): {
  groups: FileGroup[];
  errors: LoadError[];
} {
  const errors: LoadError[] = [];

  // Step 1 — ignore (silent): dot-folders, node_modules, anything deeper than MAX_WALK_DEPTH.
  const kept = entries
    .map((e, index) => ({ index, path: pathSegments(e.path).join('/'), size: e.size }))
    .filter((e) => e.path !== '' && !isIgnoredPath(e.path) && dirDepth(e.path) <= MAX_WALK_DEPTH);

  // Step 2 — walk budget: a huge folder fails the whole load before anything is read.
  if (kept.length > MAX_WALK_ENTRIES) {
    return { groups: [], errors: [folderTooLargeError(kept[0]?.path)] };
  }

  // Step 3 — group by top-level folder (a bare file name is a loose file) and pick candidates.
  const folders = new Map<string, FileGroup['entries']>();
  const order: FileGroup[] = [];
  for (const e of kept) {
    const segs = e.path.split('/');
    if (segs.length === 1) {
      if (isCsv(e.path)) order.push({ label: e.path, folder: false, entries: [e] });
      else errors.push({ file: e.path, message: 'Not a CSV file', reason: 'unsupported' });
      continue;
    }
    let list = folders.get(segs[0]);
    if (!list) {
      list = [];
      folders.set(segs[0], list);
      order.push({ label: segs[0], folder: true, entries: list });
    }
    list.push(e);
  }
  const groups: FileGroup[] = [];
  for (const g of order) {
    if (!g.folder) {
      groups.push(g);
      continue;
    }
    const inBenchmarks = g.entries.filter((e) => {
      const segs = e.path.split('/');
      return segs.length === 3 && segs[1] === 'benchmarks' && isCsv(e.path);
    });
    const candidates =
      inBenchmarks.length > 0 ? inBenchmarks : g.entries.filter((e) => isCsv(e.path));
    if (candidates.length > 0) groups.push({ ...g, entries: candidates });
  }

  // Step 4 — per-file cap.
  const all: FileGroup['entries'] = [];
  for (const g of groups) {
    for (const e of g.entries) {
      if (e.size > MAX_FILE_BYTES) {
        errors.push({ file: e.path, message: 'File too large (> 50 MB)', reason: 'too-large' });
      } else {
        all.push(e);
      }
    }
  }

  // Step 5 — count cap, deterministic order.
  all.sort((a, b) => a.path.localeCompare(b.path));
  let candidates = all;
  if (candidates.length > MAX_CSV_FILES) {
    const removed = candidates.slice(MAX_CSV_FILES);
    candidates = candidates.slice(0, MAX_CSV_FILES);
    errors.push({
      file: removed[0].path,
      message: `Too many CSV files (> ${MAX_CSV_FILES}); ${removed.length} not loaded`,
      reason: 'too-many',
    });
  }

  // Step 6 — total-bytes cap.
  let total = 0;
  let cut = candidates.length;
  for (let i = 0; i < candidates.length; i++) {
    if (total + candidates[i].size > MAX_TOTAL_BYTES) {
      cut = i;
      break;
    }
    total += candidates[i].size;
  }
  if (cut < candidates.length) {
    const removed = candidates.slice(cut);
    candidates = candidates.slice(0, cut);
    errors.push({
      file: removed[0].path,
      message: `Files too large in total (> 300 MB); ${removed.length} not loaded`,
      reason: 'too-large',
    });
  }

  const keep = new Set(candidates.map((e) => e.index));
  const result = groups
    .map((g) => ({
      ...g,
      entries: g.entries
        .filter((e) => keep.has(e.index))
        .sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .filter((g) => g.entries.length > 0);
  return { groups: result, errors };
}

export type LoadInput = FileList | File[] | { file: File; path: string }[];

function normalize(input: LoadInput): { file: File; path: string }[] {
  const items: (File | { file: File; path: string })[] = Array.from(
    input as ArrayLike<File | { file: File; path: string }>,
  );
  return items.map((it) => {
    if ('file' in it && 'path' in it) return { file: it.file, path: it.path };
    const f = it as File;
    return { file: f, path: f.webkitRelativePath || f.name };
  });
}

/** Lets the browser paint between large files (no worker: each file is parsed synchronously). */
const YIELD_BYTES = 2 * 1024 * 1024;
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function baseName(path: string): string {
  return pathSegments(path).at(-1) ?? path;
}

/** Turns one group into sources; several wandb exports in one folder become one source each. */
function sourcesOf(
  group: FileGroup,
  files: SourceFile[],
): { sources: Source[]; errors: LoadError[] } {
  const built = buildSource(files, { label: group.label, origin: 'local' });
  if (built.source && built.source.kind === 'wandb' && built.source.tables.length > 1) {
    // A wandb source is a single export (the comparison reads its first table): split it.
    const sources: Source[] = [];
    const errors: LoadError[] = [];
    for (const f of files) {
      const one = buildSource([f], {
        label: `${group.label}/${baseName(f.path)}`,
        origin: 'local',
      });
      if (one.source) sources.push(one.source);
      errors.push(...one.errors);
    }
    return { sources, errors };
  }
  return { sources: built.source ? [built.source] : [], errors: built.errors };
}

/**
 * Reads and parses local files. Never rejects; every problem becomes a `LoadError`. Called through
 * `runLoad` (src/sources/runLoad.ts) only.
 */
export async function loadFiles(
  input: LoadInput,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<{ sources: Source[]; errors: LoadError[] }> {
  try {
    const items = normalize(input);
    const { groups, errors } = groupFiles(
      items.map((it) => ({ path: it.path, size: it.file.size })),
    );
    const total = groups.reduce((n, g) => n + g.entries.length, 0);
    let done = 0;
    onProgress?.(0, total);
    const sources: Source[] = [];
    for (const group of groups) {
      const files: SourceFile[] = [];
      for (const e of group.entries) {
        if (signal?.aborted) return { sources: [], errors: [] };
        const file = items[e.index].file;
        try {
          files.push({ path: e.path, text: await file.text(), lastModified: file.lastModified });
        } catch {
          errors.push({ file: e.path, message: 'Could not read', reason: 'parse' });
        }
        done++;
        onProgress?.(done, total);
        if (e.size > YIELD_BYTES) await nextTask();
      }
      if (files.length === 0) continue;
      const built = sourcesOf(group, files);
      sources.push(...built.sources);
      errors.push(...built.errors);
      await nextTask();
    }
    if (signal?.aborted) return { sources: [], errors: [] };
    return { sources, errors };
  } catch (err) {
    return { sources: [], errors: [{ file: 'drop', message: String(err), reason: 'parse' }] };
  }
}
