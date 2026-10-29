import { useEffect, useState } from 'react';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

/**
 * Live `matchMedia(query).matches`. Falls back to `false` where `matchMedia` is missing (tests,
 * very old browsers) so callers get their narrow-layout default rather than a crash.
 */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    // Re-read: the query may have changed, or the viewport moved between render and effect
    // (spec Phase 7 useMediaQuery contract). A no-op re-render when the value is unchanged.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external source
    setValue(mql.matches);
    const handler = (e: MediaQueryListEvent) => setValue(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return value;
}
