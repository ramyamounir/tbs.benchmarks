import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { placeTooltip, type Bounds } from './tooltipPlacement';

function viewportBounds(): Bounds {
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

/**
 * Controlled, positioned tooltip anchored to a rect (e.g. a heatmap cell). Stays inside `bounds`
 * (default: the viewport), dismissed by `Esc` and by scrolling. Never takes focus.
 */
export function Tooltip({
  anchor,
  onDismiss,
  bounds,
  children,
  id,
  className,
}: {
  anchor: Bounds;
  onDismiss(): void;
  bounds?: Bounds;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pos = placeTooltip(anchor, { width, height }, bounds ?? viewportBounds());
    // One read (above), then a compositor-only write: `transform` on a fixed element moves it
    // without re-laying out the page on every hover (spec Phase 7 "Performance pass").
    el.style.transform = `translate(${pos.left}px, ${pos.top}px)`;
    el.style.visibility = 'visible';
  }, [anchor, bounds, children]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    const onScroll = () => onDismiss();
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      style={{ visibility: 'hidden', left: 0, top: 0 }}
      className={`pointer-events-none fixed z-40 max-w-[min(360px,calc(100vw-16px))] rounded-lg border border-border bg-panel px-3 py-2 text-[12px] text-text shadow-lg ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

/** Simple hover/focus hint around an element (uncontrolled wrapper of `Tooltip`). */
export function Hint({ content, children }: { content: ReactNode; children: ReactNode }) {
  const wrap = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Bounds | null>(null);
  const show = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  };
  const hide = () => setAnchor(null);
  return (
    <span
      ref={wrap}
      className="inline-flex min-w-0"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {anchor && (
        <Tooltip anchor={anchor} onDismiss={hide}>
          {content}
        </Tooltip>
      )}
    </span>
  );
}
