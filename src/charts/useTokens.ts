import { useEffect, useState } from 'react';
import { useAppStore } from '../state/store';
import { readToken } from '../theme/readToken';
import { CHART_TOKENS, type ChartTokens } from './colors';

function readAll(): ChartTokens {
  const out = {} as ChartTokens;
  for (const name of CHART_TOKENS) out[name] = readToken(name);
  return out;
}

/**
 * Literal chart token values, re-read when the resolved theme changes. The re-read is deferred one
 * animation frame so `data-theme` (set by ThemeProvider in a layout effect) has been applied.
 */
export function useTokens(): ChartTokens {
  const theme = useAppStore((s) => s.ui.resolvedTheme);
  const [tokens, setTokens] = useState<ChartTokens>(readAll);
  useEffect(() => {
    const id = requestAnimationFrame(() => setTokens(readAll()));
    return () => cancelAnimationFrame(id);
  }, [theme]);
  return tokens;
}
