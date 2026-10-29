/**
 * Number formatting for Markdown and write-back (spec Phase 2a "Number formatting"). Python formats
 * floats with round-half-to-even on the exact binary value, while JS `toFixed` rounds exact ties up
 * (`(0.125).toFixed(2)` is '0.13', Python '0.12'). No module may format a number for Markdown or
 * write-back with `toFixed` directly; use these.
 */

/** Python `f'{x:.{d}f}'` for d in 0–10. */
export function formatFixed(x: number, d: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  // Never occurs in benchmark data; Python would print all digits (documented deviation).
  if (Math.abs(x) >= 1e21) return String(x);
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  // Enough exact decimal digits of the double to tell an exact tie from a near tie.
  const long = a.toFixed(Math.min(100, d + 25));
  const [intPart, frac = ''] = long.split('.');
  const rest = frac.slice(d);
  let out: string;
  if (rest[0] === '5' && /^0*$/.test(rest.slice(1))) {
    // Exact tie: keep the truncated digits when the last is even, else add one unit (half to even).
    const digits = intPart + frac.slice(0, d);
    let kept = digits;
    if (Number(digits.at(-1)) % 2 === 1) {
      kept = (BigInt(digits) + 1n).toString().padStart(d + 1, '0');
    }
    out = d > 0 ? `${kept.slice(0, kept.length - d)}.${kept.slice(kept.length - d)}` : kept;
  } else {
    out = a.toFixed(d);
  }
  return neg ? `-${out}` : out;
}

/**
 * v1 `fmt_num`: '—' for no value, else `formatFixed` with trailing zeros (and then a trailing '.')
 * stripped. Only stripped when the text has a '.', so `fmtNum(100, 0)` is '100' (v1 would print
 * '1'; documented deviation, invisible with the default precision 2).
 */
export function fmtNum(x: number | null, prec: number): string {
  if (x === null || Number.isNaN(x)) return '—';
  const t = formatFixed(x, prec);
  if (!t.includes('.')) return t;
  return t.replace(/0+$/, '').replace(/\.$/, '');
}
