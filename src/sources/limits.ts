/**
 * Every load-side limit in one place (spec Phase 3 "Load limits"). Pure, no DOM. The CSV parser caps
 * live in `src/csv/parse.ts` (Phase 2a) and the config-file cap in `src/config/io.ts` (Phase 2b);
 * they are re-exported here so loaders import every limit from this module.
 */

export { CSV_LIMITS, CsvLimitError } from '../csv/parse';
export { MAX_CONFIG_BYTES } from '../config/io';

/** Non-ignored folder entries one load may contain (a whole clone minus `.git` is ~2,500). */
export const MAX_WALK_ENTRIES = 20_000;
/** Directory levels below the top-level folder that are still read. */
export const MAX_WALK_DEPTH = 4;
/** Candidate CSV files per load. */
export const MAX_CSV_FILES = 200;
/** Per-file cap, checked on `File.size` before the file is read. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Sum of the candidate files' sizes per load. */
export const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

export const IGNORED_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules']);

/** `.git`, `node_modules` and every other dot-folder are never read. */
export function isIgnoredDirName(name: string): boolean {
  return IGNORED_DIRS.has(name) || name.startsWith('.');
}

/** `/`-separated segments without empty ones (a leading `/` from `entry.fullPath` disappears). */
export function pathSegments(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

/** True when some directory segment (every segment but the last) is an ignored directory. */
export function isIgnoredPath(path: string): boolean {
  const segs = pathSegments(path);
  return segs.slice(0, -1).some(isIgnoredDirName);
}

/** Directory segments below the top-level folder: `top/benchmarks/x.csv` → 1, `x.csv` → 0. */
export function dirDepth(path: string): number {
  const segs = pathSegments(path);
  return segs.length >= 2 ? segs.length - 2 : 0;
}

/**
 * A loose dropped file with a config extension (`.yaml`, `.yml`, `.json`) is imported as a config
 * instead of being loaded as a source (spec Phase 4a drag-anywhere import).
 */
export function isConfigFileName(name: string): boolean {
  return /\.(ya?ml|json)$/i.test(name);
}
