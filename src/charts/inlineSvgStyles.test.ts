import { describe, expect, it } from 'vitest';
import { CHART_FONT } from './colors';
import { inlineSvgStyles } from './inlineSvgStyles';

const tokens = { '--run-1': '#8b5cf6', '--border': '#e2e5ea', '--panel': '#ffffff' };
const run = (s: string) => inlineSvgStyles(s, tokens, CHART_FONT);
const SVG = (inner: string, attrs = ' xmlns="http://www.w3.org/2000/svg"') =>
  `<svg${attrs} width="10" height="10">${inner}</svg>`;

describe('inlineSvgStyles', () => {
  it('replaces var() in attributes and style', () => {
    expect(run(SVG('<rect fill="var(--run-1)"/>'))).toContain('fill="#8b5cf6"');
    expect(run(SVG('<line style="stroke: var(--border)"/>'))).toContain('style="stroke: #e2e5ea"');
    expect(run(SVG('<rect fill="var( --panel )"/>'))).toContain('fill="#ffffff"');
  });
  it('uses the fallback, else currentColor, for unknown tokens', () => {
    expect(run(SVG('<rect fill="var(--unknown, #123456)"/>'))).toContain('fill="#123456"');
    expect(run(SVG('<rect fill="var(--unknown)"/>'))).toContain('fill="currentColor"');
    expect(run(SVG('<rect fill="var(--unknown)"/>'))).not.toContain('var(');
  });
  it('removes class attributes', () => {
    const out = run(SVG('<g class="a b"><rect class=\'x\' fill="red"/></g>'));
    expect(out).not.toContain('class');
    expect(out).toContain('<rect fill="red"/>');
  });
  it('adds font-family to text/tspan without one, keeps existing ones', () => {
    const out = run(SVG('<text x="1">a<tspan>b</tspan></text>'));
    expect(out).toContain(`<text font-family="'JetBrains Mono', ui-monospace, monospace" x="1">`);
    expect(out).toContain(`<tspan font-family="'JetBrains Mono', ui-monospace, monospace">`);
    expect(run(SVG('<text font-family="X">a</text>'))).toContain('<text font-family="X">');
    expect(inlineSvgStyles(SVG('<text>a</text>'), tokens, 'A "B"')).toContain(
      '<text font-family="A &quot;B&quot;">',
    );
  });
  it('keeps <title> children unchanged', () => {
    expect(run(SVG('<text>a<title>full name</title></text>'))).toContain(
      '<title>full name</title>',
    );
  });
  it('adds a missing xmlns only to the root svg', () => {
    const out = run(SVG('<rect/>', ''));
    expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="10"')).toBe(true);
    const kept = run(SVG('<rect/>'));
    expect(kept.match(/xmlns=/g)).toHaveLength(1);
  });
  it('is idempotent', () => {
    const input = SVG(
      '<g class="c"><text x="1" fill="var(--run-1)">a<title>t</title></text><rect style="fill: var(--x, #000)"/></g>',
      '',
    );
    const once = run(input);
    expect(run(once)).toBe(once);
  });
});
