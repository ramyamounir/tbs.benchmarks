import type { SourceKind } from '../../model/types';

/*
 * In-app drag payloads of the Config view (spec Phase 4a). Custom MIME types, so the page-level
 * file drop (src/components/DropOverlay.tsx, which reacts to 'Files' only) never sees them and they
 * never accept OS files. Every drag has a non-drag equivalent (select + Enter, ↑/↓ on a handle,
 * the "+ metric" menu).
 */

export const EXPERIMENTS_MIME = 'application/x-tbp-experiments';
export const COLUMN_MIME = 'application/x-tbp-column';
export const GROUP_MIME = 'application/x-tbp-group';
export const METRIC_CHIP_MIME = 'application/x-tbp-metric-chip';
export const GROUP_EXPERIMENT_MIME = 'application/x-tbp-group-experiment';

export function hasType(dt: DataTransfer | null, mime: string): boolean {
  return dt !== null && Array.from(dt.types).includes(mime);
}

/** Experiment names carried by a drag (a JSON string array; anything else → []). */
export function readExperiments(dt: DataTransfer): string[] {
  try {
    const v: unknown = JSON.parse(dt.getData(EXPERIMENTS_MIME));
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function readColumn(dt: DataTransfer): { kind: SourceKind; column: string } | null {
  try {
    const v: unknown = JSON.parse(dt.getData(COLUMN_MIME));
    if (typeof v !== 'object' || v === null) return null;
    const { kind, column } = v as { kind?: unknown; column?: unknown };
    if ((kind === 'repo' || kind === 'wandb') && typeof column === 'string')
      return { kind, column };
    return null;
  } catch {
    return null;
  }
}

/**
 * A small "n experiments" badge as the drag image. Built with DOM text only (no HTML); removed
 * right after the browser has captured it.
 */
export function setCountDragImage(dt: DataTransfer, count: number): void {
  if (typeof document === 'undefined' || typeof dt.setDragImage !== 'function') return;
  const el = document.createElement('div');
  el.textContent = `${count} ${count === 1 ? 'experiment' : 'experiments'}`;
  el.className =
    'fixed -top-96 left-0 rounded-md border border-accent bg-panel px-2 py-1 font-mono text-[12px] text-accent shadow';
  document.body.appendChild(el);
  dt.setDragImage(el, 12, 12);
  setTimeout(() => el.remove(), 0);
}
