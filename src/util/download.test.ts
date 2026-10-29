import { describe, expect, it } from 'vitest';
import { MIME, REVOKE_DELAY_MS, safeFileName } from './download';

const SAFE = /^[A-Za-z0-9._-]{1,120}$/;

describe('safeFileName', () => {
  it.each([
    ['../../etc/passwd', 'etc_passwd'],
    ['C:\\x', 'C_x'],
    ['..', 'download'],
    ['.', 'download'],
    ['a b.yaml', 'a_b.yaml'],
    ['../a/b.csv', 'a_b.csv'],
    ['', 'download'],
    ['___', 'download'],
    ['config-tbp-default-2026-10-29.yaml', 'config-tbp-default-2026-10-29.yaml'],
    ['.hidden', 'hidden'],
    ['name.', 'name'],
    ['a\u202Eb\u0000c.md', 'a_b_c.md'],
    ['ümlaut résumé.txt', 'mlaut_r_sum_.txt'],
  ])('safeFileName(%j) === %j', (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });

  it('caps long names at 120 characters', () => {
    expect(safeFileName('x'.repeat(200) + '.csv')).toHaveLength(120);
  });

  it('never ends a truncated name in _ or .', () => {
    const s = safeFileName('x'.repeat(119) + '_' + 'y'.repeat(10));
    expect(s).toBe('x'.repeat(119));
  });

  it('always yields a safe, non-dot name', () => {
    const inputs = [
      '../../etc/passwd',
      'C:\\x',
      '..',
      '.',
      '...',
      '/',
      '\\\\server\\share',
      ' ',
      '\u0000',
      '😀😀',
      'a'.repeat(500),
      '.'.repeat(130) + 'a',
      '_'.repeat(130),
      'x'.repeat(200) + '.csv',
      'run: pr_1184.csv',
    ];
    for (const input of inputs) {
      const out = safeFileName(input);
      expect(out).toMatch(SAFE);
      expect(out).not.toBe('.');
      expect(out).not.toBe('..');
      expect(safeFileName(out)).toBe(out); // idempotent
    }
  });
});

describe('MIME / REVOKE_DELAY_MS', () => {
  it('pins the exact MIME types', () => {
    expect(MIME).toEqual({
      csv: 'text/csv;charset=utf-8',
      zip: 'application/zip',
      png: 'image/png',
      yaml: 'text/yaml;charset=utf-8',
      json: 'application/json',
      markdown: 'text/markdown;charset=utf-8',
      text: 'text/plain;charset=utf-8',
    });
    expect(MIME.csv).toBe('text/csv;charset=utf-8');
  });

  it('revokes object URLs only after 60 s', () => {
    expect(REVOKE_DELAY_MS).toBe(60_000);
  });
});
