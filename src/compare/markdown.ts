import { fmtNum } from '../model/format';
import type { Comparison, Config, RunId } from '../model/types';
import { mdEscape } from '../util/textOut';

export interface MarkdownOptions {
  baselineLabel: string;
  /** One label per entry of `runIds` (default: every run of the comparison, in order). */
  runLabels: string[];
  /** Which runs to include, in order (e.g. only the visible ones). Default: `comparison.runs`. */
  runIds?: RunId[];
}

/**
 * v1-compatible Markdown report (tbp.benchmarks `render_markdown`): one `### experiment` table per
 * experiment, one value/Δ/result column set per run. The Metric column is the metric key (v1's
 * `output_name`) plus ` (units)`, so a v1-imported config reproduces v1 output byte for byte.
 * Numbers go through `fmtNum` (Python formatting); every other interpolated string through
 * `mdEscape`, so a `|` or a newline in a file-derived name cannot break a table.
 * Deviation from v1: v1 blanks a whole experiment when either row is missing; here each cell shows
 * what was found.
 */
export function renderMarkdown(
  comparison: Comparison,
  config: Config,
  opts: MarkdownOptions,
): string {
  const md = config.output.markdown;
  const prec = md.float_precision;
  const runIds = opts.runIds ?? comparison.runs.map((r) => r.source.id);
  const labelOf = (i: number): string =>
    opts.runLabels[i] ??
    comparison.runs.find((r) => r.source.id === runIds[i])?.source.label ??
    runIds[i];

  const headers = ['Metric', mdEscape(opts.baselineLabel)];
  runIds.forEach((_, i) => {
    headers.push(mdEscape(labelOf(i)));
    if (md.show_deltas) headers.push('Δ');
    if (md.show_pass_fail) headers.push('Result');
  });
  const headerLine = '| ' + headers.join(' | ') + ' |';
  const ruleLine = '| ' + headers.map(() => '---').join(' | ') + ' |';

  const parts: string[] = [];
  for (const g of comparison.groups) {
    const keys = [...new Set(g.group.metrics)].filter((k) => Object.hasOwn(config.metrics, k));
    for (const row of g.experiments) {
      const lines = [`### ${mdEscape(row.name)}`, '', headerLine, ruleLine];
      for (const key of keys) {
        const metric = config.metrics[key];
        let label = mdEscape(key);
        if (md.include_units_in_headers && metric.units) label += ` (${mdEscape(metric.units)})`;
        // The baseline value is the same in every run's cell; take it from the first one present.
        let base: number | null = null;
        for (const id of runIds) {
          const cell = row.cells[id]?.[key];
          if (cell) {
            base = cell.base;
            break;
          }
        }
        const cols = [label, fmtNum(base, prec)];
        for (const id of runIds) {
          const cell = row.cells[id]?.[key];
          cols.push(fmtNum(cell ? cell.value : null, prec));
          if (md.show_deltas) cols.push(fmtNum(cell ? cell.delta : null, prec));
          if (md.show_pass_fail) cols.push(mdEscape(md.symbols[cell ? cell.verdict : 'missing']));
        }
        lines.push('| ' + cols.join(' | ') + ' |');
      }
      lines.push('');
      parts.push(lines.join('\n'));
    }
  }
  return parts.join('\n').trim() + '\n';
}
