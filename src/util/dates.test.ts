import { describe, expect, it } from 'vitest';
import { formatSourceDate, localDateStamp, relativeTime } from './dates';

describe('dates', () => {
  const now = new Date(2026, 9, 29, 12).getTime();
  it('formats source dates', () => {
    expect(formatSourceDate(null, now)).toBe('—');
    expect(formatSourceDate(new Date(2026, 8, 10).getTime(), now)).toBe('Sep 10');
    expect(formatSourceDate(new Date(2025, 8, 10).getTime(), now)).toBe('Sep 10, 2025');
  });
  it('formats relative times', () => {
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now - 120_000, now)).toBe('2 min ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });

  it('localDateStamp is the local YYYY-MM-DD', () => {
    expect(localDateStamp(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateStamp(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});
