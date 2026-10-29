import { clipSubject, compileUserRegex } from '../compare/safeRegex';
import type { Transform } from './types';

/**
 * Port of v1 `apply_transforms` (tbp.benchmarks compare.py) on one cell value, with identical
 * semantics (spec Phase 2a "Transforms"): v1 parameter names, `%` stripping in `to_number`,
 * pandas/numpy round-half-to-even in `round`.
 */

export type CellValue = number | string | null;

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** The `to_number` rule (pandas `to_numeric(errors='coerce')` after removing every `%`). */
export function toNumber(v: CellValue): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  const t = String(v).replaceAll('%', '').trim();
  return NUMBER_RE.test(t) ? Number(t) : null;
}

/** numpy `rint`: round half to even. Non-finite input is returned unchanged. */
export function roundHalfEven(s: number): number {
  if (!Number.isFinite(s)) return s;
  const f = Math.floor(s);
  const diff = s - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * pandas/numpy `Series.round(d)`: scale in float64, round half to even, unscale (so 2.675 → 2.68,
 * because 2.675 * 100 === 267.5). `d === 0` never yields -0 (v1 casts to Int64).
 */
export function roundDecimals(x: number, d: number): number {
  if (d <= 0) {
    const r = roundHalfEven(x);
    return r === 0 ? 0 : r;
  }
  const p = 10 ** d;
  return roundHalfEven(x * p) / p;
}

// pandas `astype(str)`: NaN → 'nan'. (Integral floats would print as '95.0' in pandas; no shipped
// config applies a string op after a numeric one — documented deviation.)
function str(v: CellValue): string {
  if (v === null) return 'nan';
  return typeof v === 'number' ? String(v) : v;
}

/** Python `re.sub` replacement syntax → JS `String.prototype.replace` syntax, left to right. */
export function pyReplacementToJs(repl: string): string {
  let out = '';
  for (let i = 0; i < repl.length; i++) {
    const c = repl[i];
    if (c === '$') {
      out += '$$';
      continue;
    }
    if (c !== '\\' || i + 1 >= repl.length) {
      out += c;
      continue;
    }
    const next = repl[i + 1];
    const rest = repl.slice(i + 1);
    let m: RegExpExecArray | null;
    if (next === '\\') {
      out += '\\';
      i++;
    } else if ((m = /^g<(\d{1,2})>/.exec(rest))) {
      out += m[1] === '0' ? '$&' : `$${Number(m[1])}`;
      i += m[0].length;
    } else if ((m = /^g<([A-Za-z_][A-Za-z0-9_]*)>/.exec(rest))) {
      out += `$<${m[1]}>`;
      i += m[0].length;
    } else if ((m = /^[1-9]\d?/.exec(rest))) {
      out += `$${m[0]}`;
      i += m[0].length;
    } else if (next === 'n') {
      out += '\n';
      i++;
    } else if (next === 't') {
      out += '\t';
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

function intParam(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

/**
 * Apply `transforms` in order. `raw === undefined` (column missing) → null without running
 * anything; `''` reads as NaN (pandas). Returns the final value; a string result is treated as
 * missing by the comparison.
 */
export function applyTransforms(raw: string | undefined, transforms: Transform[]): CellValue {
  if (raw === undefined) return null;
  let v: CellValue = raw === '' ? null : raw;
  for (const t of transforms) {
    switch (t.kind) {
      case 'lowercase':
        v = str(v).toLowerCase();
        break;
      case 'uppercase':
        v = str(v).toUpperCase();
        break;
      case 'trim':
        v = str(v).trim();
        break;
      case 'strip_prefix': {
        const s = str(v);
        const p = String(t.value ?? '');
        v = p !== '' && s.startsWith(p) ? s.slice(p.length) : s;
        break;
      }
      case 'strip_suffix': {
        const s = str(v);
        const p = String(t.value ?? '');
        v = p !== '' && s.endsWith(p) ? s.slice(0, s.length - p.length) : s;
        break;
      }
      case 'regex_replace': {
        const compiled = compileUserRegex(String(t.pattern ?? ''), 'g');
        // v1 raises on a bad pattern; we degrade to missing.
        if ('error' in compiled) return null;
        v = clipSubject(str(v)).replace(
          compiled.re,
          pyReplacementToJs(String(t.replacement ?? '')),
        );
        break;
      }
      case 'to_number':
        v = toNumber(v);
        break;
      case 'rad_to_deg':
      case 'deg_to_rad':
      case 'sec_to_min':
      case 'min_to_sec':
      case 'frac_to_percent':
      case 'percent_to_frac': {
        const x = toNumber(v);
        if (x === null) {
          v = null;
          break;
        }
        if (t.kind === 'rad_to_deg') v = x * (180 / Math.PI);
        else if (t.kind === 'deg_to_rad') v = x * (Math.PI / 180);
        else if (t.kind === 'sec_to_min') v = x / 60;
        else if (t.kind === 'min_to_sec') v = x * 60;
        else if (t.kind === 'frac_to_percent') v = x * 100;
        else v = x / 100;
        break;
      }
      case 'scale': {
        const x = toNumber(v);
        v = x === null ? null : x * (typeof t.factor === 'number' ? t.factor : 1);
        break;
      }
      case 'clip': {
        let x = toNumber(v);
        if (x !== null && typeof t.min === 'number') x = Math.max(x, t.min);
        if (x !== null && typeof t.max === 'number') x = Math.min(x, t.max);
        v = x;
        break;
      }
      case 'round': {
        const x = toNumber(v);
        v = x === null ? null : roundDecimals(x, intParam(t.decimals, 0));
        break;
      }
      default:
        // Unknown kinds are ignored, as in v1 (validation reports them as transform-unknown).
        break;
    }
  }
  return v;
}

/** Short chip text for a transform (`round 2`, `clip 0–100`, `s → min`). */
export function describeTransform(t: Transform): string {
  switch (t.kind) {
    case 'lowercase':
    case 'uppercase':
    case 'trim':
      return t.kind;
    case 'to_number':
      return 'to number';
    case 'rad_to_deg':
      return 'rad → deg';
    case 'deg_to_rad':
      return 'deg → rad';
    case 'sec_to_min':
      return 's → min';
    case 'min_to_sec':
      return 'min → s';
    case 'frac_to_percent':
      return 'frac → %';
    case 'percent_to_frac':
      return '% → frac';
    case 'strip_prefix':
      return `strip prefix "${t.value}"`;
    case 'strip_suffix':
      return `strip suffix "${t.value}"`;
    case 'regex_replace':
      return `replace /${t.pattern}/ → "${t.replacement}"`;
    case 'round':
      return `round ${t.decimals}`;
    case 'scale':
      return `× ${t.factor}`;
    case 'clip': {
      const hasMin = typeof t.min === 'number';
      const hasMax = typeof t.max === 'number';
      if (hasMin && hasMax) return `clip ${t.min}–${t.max}`;
      if (hasMin) return `clip ≥ ${t.min}`;
      if (hasMax) return `clip ≤ ${t.max}`;
      return 'clip';
    }
    default:
      return String((t as { kind: unknown }).kind);
  }
}
