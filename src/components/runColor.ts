/**
 * Run identity colours from the token palette (`--run-1..6`), by the run's position in
 * `sources.runs` (so hiding a run never recolours the others). Full class names so Tailwind sees them.
 */
const RUN_BG = ['bg-run-1', 'bg-run-2', 'bg-run-3', 'bg-run-4', 'bg-run-5', 'bg-run-6'] as const;

export function runBg(index: number): string {
  return RUN_BG[((index % RUN_BG.length) + RUN_BG.length) % RUN_BG.length];
}
