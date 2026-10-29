import type { ReactNode } from 'react';
import { SectionHeading } from '../ui/SectionHeading';

/** Section heading + body; shared by every sidebar section of every view. */
export function SidebarSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-4">
      <SectionHeading aside={aside} className="mb-2">
        {title}
      </SectionHeading>
      {children}
    </section>
  );
}
