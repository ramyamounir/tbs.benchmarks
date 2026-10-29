import { readToken } from '../theme/readToken';
import { downloadBlob, MIME, safeFileName } from '../util/download';
import { CHART_FONT, CHART_TOKENS } from './colors';
import { inlineSvgStyles } from './inlineSvgStyles';

/*
 * Thin DOM wrapper of the PNG export (spec Phase 5b "PNG export"); all string logic lives in the
 * pure, tested inlineSvgStyles. Not unit-tested (needs a DOM and a canvas).
 */

const SCALE = 2;

/** The mounted chart `<svg>` as a 2× PNG on the panel colour of the current theme. */
export async function svgToPngBlob(svg: SVGSVGElement): Promise<Blob> {
  const { width, height } = svg.getBoundingClientRect();
  const tokens: Record<string, string> = {};
  for (const name of CHART_TOKENS) tokens[name] = readToken(name);
  const markup = inlineSvgStyles(new XMLSerializer().serializeToString(svg), tokens, CHART_FONT);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * SCALE));
      canvas.height = Math.max(1, Math.round(height * SCALE));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('PNG export failed'));
        return;
      }
      ctx.scale(SCALE, SCALE);
      ctx.fillStyle = readToken('--panel');
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) resolve(new Blob([blob], { type: MIME.png }));
        else reject(new Error('PNG export failed'));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('PNG export failed'));
    };
    img.src = url;
  });
}

export async function exportChartPng(svg: SVGSVGElement, chartId: string): Promise<void> {
  downloadBlob(safeFileName(`chart-${chartId}.png`), await svgToPngBlob(svg));
}
