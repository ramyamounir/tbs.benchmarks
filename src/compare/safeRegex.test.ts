import { describe, expect, it } from 'vitest';
import {
  MAX_PATTERN_LENGTH,
  MAX_SUBJECT_LENGTH,
  clipSubject,
  compileMatchRegex,
  compileUserRegex,
  escapeRegExp,
  pyPatternToJs,
} from './safeRegex';

const isError = (r: ReturnType<typeof compileUserRegex>) => 'error' in r;

describe('compileUserRegex guards', () => {
  it('rejects nested quantifiers', () => {
    for (const p of ['(a+)+$', '(\\d+)*x', '([a-z]+){2,}', '((a)+)+', '(?:a*)*', '(a{1,3})+']) {
      const r = compileUserRegex(p);
      expect(isError(r), p).toBe(true);
      if ('error' in r) expect(r.error).toMatch(/nested quantifier/);
    }
  });

  it('rejects backreferences', () => {
    for (const p of ['(\\w)\\1', '(?P<id>a)(?P=id)', '(?<n>a)\\k<n>']) {
      const r = compileUserRegex(p);
      expect('error' in r && r.error).toBe('backreferences are not supported');
    }
  });

  it('reports engine errors instead of throwing', () => {
    const r = compileUserRegex('[unclosed');
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toMatch(/Invalid regular expression|Unterminated/);
  });

  it('rejects patterns longer than 256 characters', () => {
    expect(MAX_PATTERN_LENGTH).toBe(256);
    expect(isError(compileUserRegex('a'.repeat(257)))).toBe(true);
    expect(isError(compileUserRegex('a'.repeat(256)))).toBe(false);
  });

  it('accepts Python named groups', () => {
    const r = compileUserRegex('(?P<id>\\w+)');
    expect('re' in r).toBe(true);
    if ('re' in r) expect(r.re.exec('ab')?.groups?.id).toBe('ab');
    expect(pyPatternToJs('(?P<x>a)(?P=x)')).toBe('(?<x>a)\\k<x>');
  });

  it('allows safe quantifier shapes', () => {
    for (const p of [
      '^x(_[a-z0-9]{8})?$',
      '(ab)+',
      '[+*]+',
      '\\(a+\\)+',
      '(a{2})+',
      '(?:ab)*',
      '(a|b)+',
    ]) {
      expect(isError(compileUserRegex(p)), p).toBe(false);
    }
  });

  it('caches results (errors too)', () => {
    expect(compileUserRegex('^a.c$')).toBe(compileUserRegex('^a.c$'));
    expect(compileUserRegex('(a+)+')).toBe(compileUserRegex('(a+)+'));
    expect(compileUserRegex('^a.c$', 'g')).not.toBe(compileUserRegex('^a.c$'));
  });
});

describe('compileMatchRegex', () => {
  it('inserts the experiment name literally', () => {
    const r = compileMatchRegex('^{name}(_[a-z0-9]{8})?$', 'a.b(c)+');
    expect('re' in r).toBe(true);
    if (!('re' in r)) return;
    expect(r.re.test('a.b(c)+')).toBe(true);
    expect(r.re.test('a.b(c)+_k3b9xq2e')).toBe(true);
    expect(r.re.test('aXb(c)+')).toBe(false);
    expect(r.re.test('a.bcc')).toBe(false);
  });

  it('handles $ sequences in names and long names', () => {
    const r = compileMatchRegex('^{name}$', 'x$&y');
    expect('re' in r && r.re.test('x$&y')).toBe(true);
    const long = 'n'.repeat(400);
    const r2 = compileMatchRegex('^{name}$', long);
    expect('re' in r2 && r2.re.test(long)).toBe(true);
  });

  it('runs the guards on the template', () => {
    expect('error' in compileMatchRegex('^({name}+)+$', 'a')).toBe(true);
    expect('error' in compileMatchRegex('[unclosed{name}', 'a')).toBe(true);
  });
});

describe('helpers', () => {
  it('clips subjects', () => {
    expect(MAX_SUBJECT_LENGTH).toBe(1024);
    expect(clipSubject('x'.repeat(5000)).length).toBe(1024);
    expect(clipSubject('abc')).toBe('abc');
  });

  it('escapes every special character', () => {
    const s = '.*+?^${}()|[]\\/';
    expect(new RegExp(`^${escapeRegExp(s)}$`).test(s)).toBe(true);
  });
});
