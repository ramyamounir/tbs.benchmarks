import { useEffect, useRef, useState } from 'react';
import { dragHasFiles, dropRoleAt, loadDataTransfer } from '../sources/drop';
import { useAppStore, type LoadRole } from '../state/store';

/**
 * Page-level drag-and-drop of files and folders. Dropping on the sidebar Baseline card sets the
 * baseline, on the Runs section adds runs, anywhere else loads with role 'auto' (the first source
 * becomes the baseline while there is none). The overlay never intercepts pointer events, so the
 * element under the pointer decides the role.
 */
export function DropOverlay() {
  const [role, setRole] = useState<LoadRole | null>(null);
  const depth = useRef(0);
  const hasBaseline = useAppStore((s) => s.sources.baseline !== null);

  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      depth.current++;
      setRole(dropRoleAt(e.target));
    };
    const onOver = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setRole(dropRoleAt(e.target));
    };
    const onLeave = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setRole(null);
    };
    const onDrop = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer) || !e.dataTransfer) return;
      e.preventDefault();
      depth.current = 0;
      setRole(null);
      void loadDataTransfer(dropRoleAt(e.target), e.dataTransfer);
    };
    document.addEventListener('dragenter', onEnter);
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onEnter);
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  if (role === null) return null;
  const asBaseline = role === 'baseline' || (role === 'auto' && !hasBaseline);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-4 border-dashed border-accent bg-accent-bg/60"
    >
      <span className="rounded-lg border border-accent bg-panel px-4 py-2 text-[15px] font-semibold text-accent shadow-lg">
        {asBaseline ? 'Drop to set as baseline' : 'Drop to add as run'}
      </span>
    </div>
  );
}
