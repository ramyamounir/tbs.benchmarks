/**
 * Read a theme token (CSS custom property from src/theme/tokens.css) for SVG chart / canvas code
 * (e.g. PNG export, which cannot resolve `var(--x)`). Call again after a `ui.resolvedTheme` change
 * (deferred one requestAnimationFrame) to pick up the new values.
 */
export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
