import type { ReactNode } from 'react';

/** 11 px uppercase semibold section heading in `text-muted`, with an optional right-aligned aside. */
export function SectionHeading({
  children,
  aside,
  as: Tag = 'h2',
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  as?: 'h2' | 'h3' | 'h4';
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 items-center justify-between gap-2 ${className ?? ''}`}>
      <Tag className="truncate text-[11px] font-semibold tracking-wide text-muted uppercase">
        {children}
      </Tag>
      {aside !== undefined && <span className="shrink-0 text-[11px] text-faint">{aside}</span>}
    </div>
  );
}
