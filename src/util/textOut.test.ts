import { describe, expect, it } from 'vitest';
import { mdEscape, plainText } from './textOut';

describe('plainText', () => {
  it('turns line breaks into spaces and strips invisible characters', () => {
    expect(plainText('a\nb')).toBe('a b');
    expect(plainText('a\r\nb\rc')).toBe('a b c');
    expect(plainText('x‮y')).toBe('xy');
    expect(plainText('x​y')).toBe('xy');
    expect(plainText('ycb_10objs.csv')).toBe('ycb_10objs.csv');
  });
});

describe('mdEscape', () => {
  it('escapes pipes after plainText', () => {
    expect(mdEscape('a|b')).toBe('a\\|b');
    expect(mdEscape('a|b\nc')).toBe('a\\|b c');
    expect(mdEscape('Num Match Steps|align right')).toBe('Num Match Steps\\|align right');
  });

  it('is the identity for names, v1 labels and symbols', () => {
    for (const s of ['randrot_noise_77obj_dist_agent', 'Percent Correct (%)', '✅', '—']) {
      expect(plainText(s)).toBe(s);
      expect(mdEscape(s)).toBe(s);
    }
  });

  it('is the identity for 200 random [A-Za-z0-9_.-] strings', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-';
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 200; i++) {
      const len = 1 + Math.floor(rand() * 40);
      let s = '';
      for (let k = 0; k < len; k++) s += alphabet[Math.floor(rand() * alphabet.length)];
      expect(plainText(s)).toBe(s);
      expect(mdEscape(s)).toBe(s);
    }
  });
});
