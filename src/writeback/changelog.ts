import { plainText } from '../util/textOut';
import type { WritebackPlan } from './plan';

/**
 * The write-back change log in the v1 `--dry-run` style (spec Phase 6 "Change-log format"). The
 * arrow is U+2192 where v1 prints ASCII `->` (intentional: the log is for humans; v1 parity is
 * checked on parsed tuples, never on this text). Every file-derived string goes through
 * `plainText`, so a multi-line quoted field or a bidi control can never split or disguise a line.
 */
export function formatChangelog(plan: WritebackPlan): string {
  const blocks: string[] = [];
  for (const tp of plan.tables) {
    if (tp.entries.length === 0) continue;
    let block = `=== Modify: ${plainText(tp.path)} ===\n`;
    for (const e of tp.entries) {
      const head = `${plainText(e.experiment)} | ${plainText(e.column)} | ${plainText(e.old)}`;
      block +=
        e.skipped === undefined
          ? `${head} → ${plainText(e.new)}\n`
          : `${head} · skipped (${e.skipped})\n`;
    }
    blocks.push(block);
  }
  return blocks.join('\n');
}
