import { describe, expect, it } from 'vitest';
import { placeTooltip } from './tooltipPlacement';

const VIEW = { left: 0, top: 0, right: 1000, bottom: 800 };
const SIZE = { width: 200, height: 100 };

describe('placeTooltip', () => {
  it('places below the anchor when there is room', () => {
    expect(placeTooltip({ left: 100, top: 100, right: 120, bottom: 120 }, SIZE, VIEW)).toEqual({
      left: 100,
      top: 128,
    });
  });

  it('flips above the anchor near the bottom edge', () => {
    expect(placeTooltip({ left: 100, top: 700, right: 120, bottom: 720 }, SIZE, VIEW)).toEqual({
      left: 100,
      top: 592,
    });
  });

  it('clamps horizontally inside the bounds', () => {
    expect(placeTooltip({ left: 950, top: 100, right: 970, bottom: 120 }, SIZE, VIEW).left).toBe(
      792,
    );
    expect(placeTooltip({ left: -50, top: 100, right: -30, bottom: 120 }, SIZE, VIEW).left).toBe(8);
  });

  it('stays inside custom bounds', () => {
    const bounds = { left: 272, top: 52, right: 1000, bottom: 400 };
    const p = placeTooltip({ left: 280, top: 60, right: 300, bottom: 380 }, SIZE, bounds);
    expect(p.left).toBeGreaterThanOrEqual(280);
    expect(p.top).toBeGreaterThanOrEqual(60);
    expect(p.top + SIZE.height).toBeLessThanOrEqual(392);
  });
});
