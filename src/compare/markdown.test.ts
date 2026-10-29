import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath, smallBaseline, smallRun } from '../fixtures/files';
import { v1SmallConfig } from '../fixtures/v1_small.config';
import { buildSource } from '../model/source';
import type { Config } from '../model/types';
import { compareAll } from './compare';
import { renderMarkdown } from './markdown';

const EXPECTED = fixturePath('v1_expected.md');

/** Unescaped `|` count of a Markdown table line. */
const pipes = (line: string) => line.replace(/\\\|/g, '').split('|').length - 1;

describe('renderMarkdown', () => {
  it('escapes file-derived names so tables stay intact', () => {
    const config: Config = v1SmallConfig();
    config.groups = [{ ...config.groups[0], experiments: ['a|b\nc'] }];
    const baseline = buildSource(
      [
        {
          path: 'benchmarks/ycb_10objs.csv',
          text: 'Experiment,Correct (%)|align right\n"a|b\nc",95\n',
          lastModified: 0,
        },
      ],
      { label: 'Baseline', origin: 'local' },
    ).source!;
    const run = buildSource(
      [
        {
          path: 'r.csv',
          text: 'Name,State,overall/percent_correct\n"a|b\nc",finished,96\n',
          lastModified: 0,
        },
      ],
      { label: 'r|1', origin: 'local' },
    ).source!;
    const md = renderMarkdown(compareAll(config, baseline, [run], {}), config, {
      baselineLabel: 'Base|line',
      runLabels: ['r|1'],
    });
    const lines = md.split('\n');
    expect(lines[0]).toBe('### a\\|b c');
    expect(lines[2]).toBe('| Metric | Base\\|line | r\\|1 | Δ | Result |');
    const table = lines.filter((l) => l.startsWith('|'));
    expect(table.length).toBeGreaterThan(2);
    for (const l of table) expect(pipes(l)).toBe(pipes(lines[2]));
    expect(lines).toContain('| percent_correct (%) | 95 | 96 | 1 | ✅ |');
  });

  it('renders one column set per run and honours output options', () => {
    const config = v1SmallConfig();
    const baseline = smallBaseline();
    const r1 = smallRun('one');
    const r2 = smallRun('two');
    const cmp = compareAll(config, baseline, [r1, r2], {});
    const md = renderMarkdown(cmp, config, { baselineLabel: 'B', runLabels: ['one', 'two'] });
    expect(md).toContain('| Metric | B | one | Δ | Result | two | Δ | Result |');
    expect(md).toContain('| percent_correct (%) | 100 | 90 | -10 | ❌ | 90 | -10 | ❌ |');
    config.output.markdown.show_deltas = false;
    config.output.markdown.include_units_in_headers = false;
    const md2 = renderMarkdown(cmp, config, {
      baselineLabel: 'B',
      runLabels: ['two'],
      runIds: [r2.id],
    });
    expect(md2).toContain('| Metric | B | two | Result |');
    expect(md2).toContain('| rotation_error | 3.64 | 3.5 | ✅ |');
    expect(md2.endsWith('|\n')).toBe(true);
  });

  it.skipIf(!existsSync(EXPECTED))('reproduces v1 compare.py output byte for byte', () => {
    const text = readFileSync(EXPECTED, 'utf8');
    const expected = text.slice(text.indexOf('\n') + 1);
    const config = v1SmallConfig();
    const cmp = compareAll(config, smallBaseline(), [smallRun('Proposed')], {});
    expect(
      renderMarkdown(cmp, config, { baselineLabel: 'Baseline', runLabels: ['Proposed'] }),
    ).toBe(expected);
  });
});
