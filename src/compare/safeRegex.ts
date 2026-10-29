/**
 * The only place a user-supplied pattern (group/source `match: { regex }`, `regex_replace.pattern`)
 * becomes a RegExp (spec Phase 2a "User regexes"). Patterns run synchronously on the main thread for
 * every group × experiment × run × row and are recomputed while typing, and JS regexes have no
 * timeout, so every pattern is length-limited, rejects backreferences and nested quantifiers, and
 * every subject is clipped. Nothing here throws.
 *
 * Known limits (not handled): alternation-based blow-ups such as `(a|a)*` are not detected; the
 * 1,024-character subject cap bounds their cost.
 */

export const MAX_PATTERN_LENGTH = 256;
export const MAX_SUBJECT_LENGTH = 1024;
const MAX_CACHE = 2_000;

export type CompiledRegex = { re: RegExp } | { error: string };

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Python named-group syntax → JS: `(?P<n>` → `(?<n>`, `(?P=n)` → `\k<n>` (then rejected). */
export function pyPatternToJs(pattern: string): string {
  return pattern.replace(/\(\?P</g, '(?<').replace(/\(\?P=([^)]*)\)/g, '\\k<$1>');
}

export function clipSubject(s: string): string {
  return s.length > MAX_SUBJECT_LENGTH ? s.slice(0, MAX_SUBJECT_LENGTH) : s;
}

// `{n,}` or `{n,m}` (an unbounded or ranged repeat); exact `{n}` is not counted.
const RANGE_QUANT = /^\{\d+,\d*\}/;

/** Rejects backreferences and nested quantifiers (`(a+)+`, `(\d+)*`, `([a-z]+){2,}`). */
function scanPattern(p: string): string | null {
  const stack: boolean[] = []; // per open group: does its body contain an unbounded quantifier?
  let inClass = false;
  const mark = () => {
    if (stack.length > 0) stack[stack.length - 1] = true;
  };
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') {
      const next = p[i + 1] ?? '';
      if (!inClass && (/[1-9]/.test(next) || (next === 'k' && p[i + 2] === '<'))) {
        return 'backreferences are not supported';
      }
      i++; // the escaped character is literal
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '(') {
      stack.push(false);
      if (p[i + 1] === '?') {
        // Group prefix (?:, (?=, (?!, (?<=, (?<!, (?<name>: its `?` is not a quantifier.
        i++;
        if (p[i + 1] === '<' && p[i + 2] !== '=' && p[i + 2] !== '!') {
          const close = p.indexOf('>', i);
          i = close === -1 ? p.length : close;
        } else if (p[i + 1] === '<') {
          i += 2;
        } else {
          i += 1;
        }
      }
      continue;
    }
    if (c === ')') {
      const inner = stack.pop() ?? false;
      const after = p.slice(i + 1);
      const quantified = after[0] === '+' || after[0] === '*' || RANGE_QUANT.test(after);
      if (inner && quantified) return 'nested quantifier (e.g. (a+)+) can hang the page';
      if (inner) mark(); // the parent's body contains this group's quantifier
      continue;
    }
    if (c === '+' || c === '*') {
      mark();
      continue;
    }
    if (c === '{') {
      const m = RANGE_QUANT.exec(p.slice(i));
      if (m) {
        mark();
        i += m[0].length - 1;
      }
    }
  }
  return null;
}

const cache = new Map<string, CompiledRegex>();

function compile(pattern: string, flags: string, opts: { checkLength: boolean }): CompiledRegex {
  const key = `${opts.checkLength ? 1 : 0}\u0000${flags}\u0000${pattern}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let result: CompiledRegex;
  if (opts.checkLength && pattern.length > MAX_PATTERN_LENGTH) {
    result = { error: `pattern longer than ${MAX_PATTERN_LENGTH} characters` };
  } else {
    const p = pyPatternToJs(pattern);
    const problem = scanPattern(p);
    if (problem !== null) {
      result = { error: problem };
    } else {
      try {
        result = { re: new RegExp(p, flags) };
      } catch (e) {
        result = { error: (e as Error).message };
      }
    }
  }
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, result);
  return result;
}

/**
 * Compile a user pattern (Python syntax accepted). Cached and shared: callers use the RegExp only
 * with `String.prototype.replace` (which resets `lastIndex` for `g`) or, without `g`, `test`/`exec`.
 */
export function compileUserRegex(pattern: string, flags = ''): CompiledRegex {
  return compile(pattern, flags, { checkLength: true });
}

/**
 * A match template (`^{name}(_[a-z0-9]{8})?$`) for one experiment name. The guards run on the
 * template (so the name never counts toward the length limit); the name is inserted escaped, so it
 * matches literally.
 */
export function compileMatchRegex(template: string, name: string): CompiledRegex {
  const guard = compileUserRegex(template.replaceAll('{name}', 'x'));
  if ('error' in guard) return guard;
  const escaped = escapeRegExp(name);
  // Function replacer: a string replacement would interpret `$&` etc. inside the escaped name.
  return compile(
    template.replaceAll('{name}', () => escaped),
    '',
    { checkLength: false },
  );
}
