/**
 * The only place that triggers a browser download (spec Phase 1 "Download helper"). Download
 * names are built from untrusted strings (config names, chart ids, run labels from file names),
 * so every name goes through `safeFileName`; every Blob is typed with a `MIME` value.
 */

export const MIME = {
  csv: 'text/csv;charset=utf-8',
  zip: 'application/zip',
  png: 'image/png',
  yaml: 'text/yaml;charset=utf-8',
  json: 'application/json',
  markdown: 'text/markdown;charset=utf-8',
  text: 'text/plain;charset=utf-8',
} as const;

/**
 * Revoking the object URL in the same tick (or a 0 ms timeout) after `click()` can cancel the
 * download in Firefox and Safari; never revoking leaks the Blob (zips can be several MB).
 */
export const REVOKE_DELAY_MS = 60_000;

const MAX_NAME = 120;
const FALLBACK = 'download';

/** Strip trailing `_` and `.` (a name may never end in a dot on Windows, nor in our filler `_`). */
function trimEnd(s: string): string {
  return s.replace(/[_.]+$/, '');
}

/**
 * A file name safe on every OS: only `[A-Za-z0-9._-]`, no path separators, no leading dots (so
 * never `.` / `..` / hidden files), at most 120 characters, never empty. Pure, no DOM.
 */
export function safeFileName(name: string): string {
  let s = String(name)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+/, '');
  s = trimEnd(s);
  if (s.length > MAX_NAME) s = trimEnd(s.slice(0, MAX_NAME));
  return s === '' ? FALLBACK : s;
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(name); // idempotent; applied again in case a caller forgot
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
