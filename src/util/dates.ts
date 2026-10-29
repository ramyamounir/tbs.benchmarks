/** Source date as `Sep 10` (this year) or `Sep 10, 2025`; null → `—` (spec Phase 3). */
export function formatSourceDate(ms: number | null, now = Date.now()): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "just now", "2 min ago", "3 h ago", "4 days ago" — for "Saved in browser · …". */
export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Local calendar date as `YYYY-MM-DD` (download file names). */
export function localDateStamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
