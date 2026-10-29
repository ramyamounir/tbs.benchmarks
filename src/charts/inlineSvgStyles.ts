/*
 * Pure SVG markup post-processing for PNG export (spec Phase 5b "PNG export"). An <svg> drawn into
 * a canvas through an <img> is isolated from the page: CSS variables and classes do not resolve
 * there, so every `var(--x)` becomes its literal token value and classes are dropped. String/regex
 * processing only (no DOMParser / document / XMLSerializer), so it runs and is tested in Node.
 */

const VAR_RE = /var\(\s*(--[A-Za-z0-9-]+)\s*(?:,\s*([^()]*?))?\s*\)/g;
const CLASS_RE = /\sclass\s*=\s*("[^"]*"|'[^']*')/g;
const TEXT_TAG_RE = /<(text|tspan)(?=[\s>/])([^>]*)>/g;
const SVG_TAG_RE = /<svg(?=[\s>/])([^>]*)>/;

export function inlineSvgStyles(
  svgMarkup: string,
  tokens: Record<string, string>,
  fontFamily: string,
): string {
  // 1. var(--name[, fallback]) → token value, else fallback, else currentColor.
  let out = svgMarkup.replace(VAR_RE, (_m, name: string, fallback: string | undefined) => {
    if (Object.hasOwn(tokens, name)) return tokens[name];
    const fb = fallback?.trim();
    return fb ? fb : 'currentColor';
  });
  // 2. Charts must not depend on classes.
  out = out.replace(CLASS_RE, '');
  // 3. Every <text>/<tspan> carries a font-family.
  const font = fontFamily.replace(/"/g, '&quot;');
  out = out.replace(TEXT_TAG_RE, (m, tag: string, attrs: string) =>
    /\sfont-family\s*=/.test(attrs) ? m : `<${tag} font-family="${font}"${attrs}>`,
  );
  // 4. A standalone SVG document needs its namespace.
  out = out.replace(SVG_TAG_RE, (m, attrs: string) =>
    /\sxmlns\s*=/.test(attrs) ? m : `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>`,
  );
  return out;
}
