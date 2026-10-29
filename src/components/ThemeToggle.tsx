import { useAppStore, type Theme } from '../state/store';

const NEXT_THEME: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};
const THEME_LABEL: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

function ThemeIcon({ theme }: { theme: Theme }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (theme === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  }
  if (theme === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

/** Cycles light → dark → system; the choice is persisted by ThemeProvider. */
export function ThemeToggle() {
  const theme = useAppStore((s) => s.ui.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const next = NEXT_THEME[theme];
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 text-[13px] text-text hover:bg-row-alt focus-visible:outline-2 focus-visible:outline-accent"
      title={`Theme: ${THEME_LABEL[theme]} (click for ${THEME_LABEL[next]})`}
      aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`}
    >
      <ThemeIcon theme={theme} />
      <span className="max-[1100px]:hidden">{THEME_LABEL[theme]}</span>
    </button>
  );
}
