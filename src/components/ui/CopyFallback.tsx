import { useEffect, useRef } from 'react';
import { Button } from './Button';

/**
 * Shown when the Clipboard API is unavailable: the text in a read-only, pre-selected textarea so
 * the user can copy it with Ctrl/Cmd+C. The text is a React value (never HTML).
 */
export function CopyFallback({
  text,
  label,
  onClose,
}: {
  text: string;
  label: string;
  onClose(): void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [text]);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-muted">
          Copying is not available here. The text is selected: press Ctrl+C (⌘C on macOS).
        </p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <textarea
        ref={ref}
        readOnly
        aria-label={label}
        value={text}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        className="h-40 w-full resize-y rounded-md border border-border bg-row-alt p-2 font-mono text-[11px] text-text focus-visible:outline-2 focus-visible:outline-accent"
      />
    </div>
  );
}
