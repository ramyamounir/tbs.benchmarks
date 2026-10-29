/** Pure tooltip placement (no DOM), shared by `Tooltip` and unit-tested. */

const GAP = 8;
const MARGIN = 8;

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Pure placement: below the anchor, flipped above when it would leave `bounds`, then clamped
 * horizontally (and vertically as a last resort) so the tooltip stays inside `bounds`.
 */
export function placeTooltip(
  anchor: Bounds,
  size: { width: number; height: number },
  bounds: Bounds,
): { left: number; top: number } {
  let top = anchor.bottom + GAP;
  if (top + size.height > bounds.bottom - MARGIN && anchor.top - GAP - size.height >= bounds.top) {
    top = anchor.top - GAP - size.height;
  }
  top = Math.max(bounds.top + MARGIN, Math.min(top, bounds.bottom - MARGIN - size.height));
  let left = anchor.left;
  left = Math.min(left, bounds.right - MARGIN - size.width);
  left = Math.max(left, bounds.left + MARGIN);
  return { left, top };
}
