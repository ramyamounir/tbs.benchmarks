import type { Verdict } from '../../model/types';

/**
 * Colour never carries meaning alone (spec Phase 1 "Design tokens"): every verdict cell and chip
 * shows one of these glyphs next to its colour.
 */
export const VERDICT_GLYPH: Record<Verdict, string> = {
  better: '▲',
  worse: '▼',
  same: '=',
  mismatch: '!',
  missing: '—',
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  better: 'better',
  worse: 'worse',
  same: 'same',
  mismatch: 'mismatch',
  missing: 'missing',
};

/** Token utilities per verdict for chips. Amber (`warn`) is reserved for warnings, never a verdict. */
export const VERDICT_CHIP_CLASS: Record<Verdict, string> = {
  better: 'bg-better-bg text-better border-transparent',
  worse: 'bg-worse-bg text-worse border-transparent',
  same: 'bg-heat-same text-muted border-transparent',
  mismatch: 'bg-panel text-text border-text',
  missing: 'bg-transparent text-faint border-dashed border-faint',
};
