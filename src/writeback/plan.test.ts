import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareAll } from '../compare/compare';
import { rewriteRows } from '../csv/write';
import { fixturePath, readFixture, smallBaseline, smallRun } from '../fixtures/files';
import { v1SmallConfig } from '../fixtures/v1_small.config';
import { buildSource } from '../model/source';
import { applyTransforms } from '../model/transforms';
import type { Config, Metric, Source, Transform } from '../model/types';
import { emptyConfig } from '../model/types';
import {
  formatLikeBaseline,
  formatPlain,
  isWritableMetric,
  keptKey,
  planWriteback,
  tableChanges,
  type WritebackOptions,
  type WritebackPlan,
} from './plan';

const V1_OPTS = (): WritebackOptions => ({
  keepFormatting: true,
  skipWithinTol: false,
  skipEpisodeMismatch: false,
  kept: new Set(),
});

function source(path: string, text: string, label = path): Source {
  const { source } = buildSource([{ path, text, lastModified: 0 }], { label, origin: 'local' });
  if (!source) throw new Error(`${path} did not build`);
  return source;
}

function plan(config: Config, baseline: Source, run: Source, opts = V1_OPTS()): WritebackPlan {
  return planWriteback(compareAll(config, baseline, [run], {}), config, baseline, run, opts);
}

const changes = (p: WritebackPlan) =>
  p.tables.flatMap((t) => t.entries.filter((e) => e.skipped === undefined));

// ---- Inline fixtures: a 2-row repo table and a wandb run ----

const REPO_CSV =
  'Experiment,Correct (%)|align right,Run Time (mins)|align right,Num Episodes|hidden\n' +
  'exp_a,90.00,14,100\n' +
  'exp_b,80.00,10,100\n';

function metric(
  label: string,
  repo: [string, Transform[]],
  wandb: [string, Transform[]],
  extra: Partial<Metric> = {},
): Metric {
  return {
    label,
    direction: 'higher',
    tolerance: 0.5,
    tolerance_mode: 'absolute',
    decimals: 1,
    columns: {
      repo: { column: repo[0], transforms: repo[1] },
      wandb: { column: wandb[0], transforms: wandb[1] },
    },
    ...extra,
  };
}

const TO_NUM: Transform[] = [{ kind: 'to_number' }];

function inlineConfig(over: Partial<Record<string, Metric>> = {}): Config {
  const c = emptyConfig();
  c.metrics = {
    percent_correct: metric(
      'Correct',
      ['Correct (%)|align right', [...TO_NUM, { kind: 'round', decimals: 2 }]],
      ['overall/percent_correct', TO_NUM],
    ),
    runtime: metric(
      'Runtime',
      ['Run Time (mins)|align right', [...TO_NUM, { kind: 'round', decimals: 0 }]],
      ['Runtime', [...TO_NUM, { kind: 'sec_to_min' }, { kind: 'round', decimals: 0 }]],
      { direction: 'lower' },
    ),
    num_episodes: metric(
      'Episodes',
      ['Num Episodes|hidden', TO_NUM],
      ['overall/num_episodes', TO_NUM],
      { direction: 'match', tolerance: 0 },
    ),
    ...(over as Record<string, Metric>),
  };
  c.groups = [
    {
      name: 't',
      table: 'benchmarks/t.csv',
      metrics: Object.keys(c.metrics),
      column_overrides: {},
      experiments: ['exp_a', 'exp_b'],
    },
  ];
  return c;
}

function wandbRun(rows: string[][], label = 'run.csv'): Source {
  const header = 'Name,State,Runtime,overall/percent_correct,overall/num_episodes';
  return source(label, [header, ...rows.map((r) => r.join(','))].join('\n') + '\n', label);
}

const repoBase = (text = REPO_CSV) => source('benchmarks/t.csv', text, 'tbp.monty');

// ---- v1 dry-run parity ----

const DRYRUN = fixturePath('v1_expected_dryrun.txt');

interface Tuple {
  table: string;
  experiment: string;
  column: string;
  old: string;
  new: string;
}

function parseDryRun(text: string): Tuple[] {
  const out: Tuple[] = [];
  let table = '';
  for (const line of text.split('\n').slice(1)) {
    if (line.trim() === '') continue;
    const head = /^=== Modify: (.+) ===$/.exec(line);
    if (head) {
      table = head[1];
      continue;
    }
    const m = /^(.+?) \| (.+?) \| (.+?) -> (.+)$/.exec(line);
    if (!m) throw new Error(`Unexpected line in v1 dry-run output: ${line}`);
    out.push({ table, experiment: m[1], column: m[2], old: m[3], new: m[4] });
  }
  return out;
}

/** Tuples grouped per table (v1 prints files sorted by its file-spec key, v2 in config order). */
const byTable = (list: Tuple[]) => {
  const m = new Map<string, Tuple[]>();
  for (const t of list) m.set(t.table, [...(m.get(t.table) ?? []), t]);
  return Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
};

describe('planWriteback v1 parity', () => {
  it.skipIf(!existsSync(DRYRUN))('matches compare.py --modify-in-place --dry-run', () => {
    const expected = parseDryRun(readFileSync(DRYRUN, 'utf8'));
    expect(expected.length).toBeGreaterThan(0);
    const p = plan(v1SmallConfig(), smallBaseline(), smallRun());
    const actual = p.tables.flatMap((t) =>
      t.entries
        .filter((e) => e.skipped === undefined)
        .map((e) => ({
          table: t.path,
          experiment: e.experiment,
          column: e.column,
          old: e.old,
          new: e.new,
        })),
    );
    expect(byTable(actual)).toEqual(byTable(expected));
  });
});

// ---- Options ----

describe('planWriteback options', () => {
  // exp_a: correct 90.00 → 90.3 (within tol 0.5), runtime 14 → 12 (720 s); exp_b: 80 → 85, episodes differ.
  const run = () =>
    wandbRun([
      ['exp_a_x1', 'finished', '720', '90.3', '100'],
      ['exp_b_x2', 'finished', '600', '85', '50'],
    ]);

  it('v1-equivalent options write every changed cell', () => {
    const p = plan(inlineConfig(), repoBase(), run());
    expect(changes(p).map((e) => [e.experiment, e.column, e.old, e.new])).toEqual([
      ['exp_a', 'Correct (%)|align right', '90.00', '90.30'],
      ['exp_a', 'Run Time (mins)|align right', '14', '12'],
      ['exp_b', 'Correct (%)|align right', '80.00', '85.00'],
      ['exp_b', 'Num Episodes|hidden', '100', '50'],
    ]);
  });

  it('skipWithinTol skips cells with verdict same', () => {
    const p = plan(inlineConfig(), repoBase(), run(), { ...V1_OPTS(), skipWithinTol: true });
    const e = p.tables[0].entries.find(
      (x) => x.experiment === 'exp_a' && x.metric === 'percent_correct',
    );
    expect(e?.skipped).toBe('tolerance');
    expect(e?.new).toBe('90.30');
    expect(changes(p)).toHaveLength(3);
  });

  it('skipEpisodeMismatch skips the whole experiment row', () => {
    const p = plan(inlineConfig(), repoBase(), run(), { ...V1_OPTS(), skipEpisodeMismatch: true });
    const b = p.tables[0].entries.filter((x) => x.experiment === 'exp_b');
    expect(b.map((x) => x.skipped)).toEqual(['episodes', 'episodes']);
    expect(changes(p).every((x) => x.experiment === 'exp_a')).toBe(true);
  });

  it('keepFormatting: false uses the metric decimals (reformatting counts as a change)', () => {
    const p = plan(inlineConfig(), repoBase(), run(), { ...V1_OPTS(), keepFormatting: false });
    expect(changes(p).map((e) => e.new)).toEqual(['90.3', '12.0', '100.0', '85.0', '10.0', '50.0']);
  });

  it('kept skips only keys of this run', () => {
    const r = run();
    const key = keptKey(r.id, 'benchmarks/t.csv', 'exp_a', 'Run Time (mins)|align right');
    const p = plan(inlineConfig(), repoBase(), r, { ...V1_OPTS(), kept: new Set([key]) });
    const e = p.tables[0].entries.find((x) => x.metric === 'runtime' && x.experiment === 'exp_a');
    expect(e?.skipped).toBe('kept');
    expect(e?.new).toBe('12');

    const other = keptKey(
      'another-run',
      'benchmarks/t.csv',
      'exp_a',
      'Run Time (mins)|align right',
    );
    const q = plan(inlineConfig(), repoBase(), r, { ...V1_OPTS(), kept: new Set([other]) });
    expect(changes(q)).toHaveLength(4);
  });

  it('an experiment absent from the run has no entry and is listed in notInRun', () => {
    const p = plan(
      inlineConfig(),
      repoBase(),
      wandbRun([['exp_a', 'finished', '720', '95', '100']]),
    );
    expect(p.tables[0].entries.some((e) => e.experiment === 'exp_b')).toBe(false);
    expect(p.tables[0].notInRun).toEqual(['exp_b']);
    expect(p.tables[0].experiments).toBe(2);
  });
});

// ---- Formatters ----

describe('formatLikeBaseline / formatPlain', () => {
  it('rounds ties half-to-even like Python', () => {
    expect(formatLikeBaseline('0.10', 0.125, 2)).toBe('0.12');
    expect(formatLikeBaseline('2%', 2.5, 2)).toBe('2%');
    expect(formatLikeBaseline('', 3.5, 0)).toBe('4');
  });

  it('keeps decimals, % and the verbatim prefix/suffix of the old cell', () => {
    expect(formatLikeBaseline('29.27', 27.8412, 2)).toBe('27.84');
    expect(formatLikeBaseline('16.45%', 15.1501, 2)).toBe('15.15%');
    expect(formatLikeBaseline('31', 30.4, 2)).toBe('30');
    expect(formatLikeBaseline('n/a', 3.14159, 3)).toBe('3.142');
    expect(formatLikeBaseline('~ 5.0 deg', 4.25, 2)).toBe('~ 4.2 deg');
  });

  it('(d) never writes negative zero, exponents or non-finite values', () => {
    expect(formatLikeBaseline('0.10', -0.001, 2)).toBe('0.00');
    expect(formatPlain('5%', -0.001, 1)).toBe('0.0%');
    expect(formatLikeBaseline('1.0', 1e21, 1)).toBeNull();
    expect(formatLikeBaseline('1.0', NaN, 1)).toBeNull();
    expect(formatPlain('1', Infinity, 0)).toBeNull();
    expect(formatPlain('1', -Infinity, 0)).toBeNull();
  });
});

// ---- Writable cells ----

describe('writable cells', () => {
  it('isWritableMetric rejects unit- or text-changing baseline transforms only', () => {
    const m = (t: Transform[]) => metric('m', ['c', t], ['c', []]);
    expect(isWritableMetric(m([...TO_NUM, { kind: 'round', decimals: 2 }]), 'repo')).toBe(true);
    expect(isWritableMetric(m([{ kind: 'trim' }, { kind: 'clip', min: 0 }]), 'repo')).toBe(true);
    expect(isWritableMetric(m([{ kind: 'scale', factor: 1 }]), 'repo')).toBe(false);
    expect(isWritableMetric(m([{ kind: 'sec_to_min' }]), 'repo')).toBe(false);
    expect(isWritableMetric(m([{ kind: 'sec_to_min' }]), 'wandb')).toBe(true);
  });

  it('(a) a formula-like run cell is skipped as non-numeric and never written', () => {
    const config = inlineConfig({
      percent_correct: metric(
        'Correct',
        ['Correct (%)|align right', TO_NUM],
        ['overall/percent_correct', []],
      ),
    });
    const base = repoBase();
    const p = plan(config, base, wandbRun([['exp_a', 'finished', '840', '=1+1', '100']]));
    const e = p.tables[0].entries.find((x) => x.metric === 'percent_correct');
    expect(e?.skipped).toBe('non-numeric');
    expect(e?.new).toBe('90.00');
    expect(changes(p).some((x) => x.metric === 'percent_correct')).toBe(false);
    const out = rewriteRows(p.tables[0].table.csv, tableChanges(p.tables[0]));
    expect(out).not.toContain('=1+1');
  });

  it('(b) a baseline column with sec_to_min is not writable; with to_number + round it is', () => {
    const run = wandbRun([['exp_a', 'finished', '720', '90', '100']]);
    const sec = inlineConfig({
      runtime: metric(
        'Runtime',
        ['Run Time (mins)|align right', [...TO_NUM, { kind: 'sec_to_min' }]],
        ['Runtime', TO_NUM],
      ),
    });
    const p = plan(sec, repoBase(), run);
    const rt = p.tables[0].entries.filter((x) => x.metric === 'runtime');
    expect(rt.length).toBeGreaterThan(0);
    expect(rt.every((x) => x.skipped === 'transform' && x.new === x.old)).toBe(true);
    expect(p.tables[0].unwritable).toEqual(['Run Time (mins)|align right']);

    const ok = plan(inlineConfig(), repoBase(), run);
    expect(changes(ok).find((x) => x.metric === 'runtime')?.new).toBe('12');
    expect(ok.tables[0].unwritable).toEqual([]);
  });

  it('(c) an infinite run value (scale 1e308) is skipped as non-numeric', () => {
    const config = inlineConfig({
      percent_correct: metric(
        'Correct',
        ['Correct (%)|align right', TO_NUM],
        ['overall/percent_correct', [...TO_NUM, { kind: 'scale', factor: 1e308 }]],
      ),
    });
    const p = plan(config, repoBase(), wandbRun([['exp_a', 'finished', '840', '10', '100']]));
    const e = p.tables[0].entries.find((x) => x.metric === 'percent_correct');
    expect(e?.skipped).toBe('non-numeric');
    expect(changes(p).some((x) => x.metric === 'percent_correct')).toBe(false);
  });

  it('(e) round trip: written cells read back as the planned values', () => {
    const config = v1SmallConfig();
    const baseline = smallBaseline();
    const roundTrip = (run: Source) => {
      const p = plan(config, baseline, run);
      const texts = p.tables.map((t) => ({
        path: t.path,
        text: rewriteRows(t.table.csv, tableChanges(t)),
        lastModified: 0,
      }));
      const untouched = baseline.tables
        .filter((t) => !p.tables.some((x) => x.path === t.path))
        .map((t) => ({ path: t.path, text: t.csv.text, lastModified: 0 }));
      const rebuilt = buildSource([...texts, ...untouched], {
        label: 'rebuilt',
        origin: 'local',
      }).source!;
      const cmp = compareAll(config, rebuilt, [run], {});
      const rows = cmp.groups.flatMap((g) => g.experiments);
      const written = changes(p);
      expect(written.length).toBeGreaterThan(0);
      return written.map((e) => {
        const cell = rows.find((r) => r.name === e.experiment)!.cells[run.id][e.metric];
        const transforms = config.metrics[e.metric].columns.repo!.transforms;
        expect(cell.base).toBe(applyTransforms(e.new, transforms));
        return cell;
      });
    };

    roundTrip(smallRun());

    const header =
      'Name,State,Runtime,overall/percent_correct,overall/avg_rotation_error,LM_2/overall/percent_correct';
    const exact = source(
      'exact.csv',
      [
        header,
        'base_config_10distinctobj_dist_agent_a1,finished,1,95.5,7.25,',
        'base_config_10distinctobj_surf_agent_b2,finished,1,88,2.5,',
        'randrot_noise_sim_on_scan_monty_world_c3,finished,1,50,1,91.25',
      ].join('\n') + '\n',
    );
    const cells = roundTrip(exact);
    expect(cells.every((c) => c.verdict === 'same')).toBe(true);
  });

  it('keeps the BOM, quoting and line endings of the file', () => {
    const text =
      '﻿Experiment,"Correct (%)|align right",Run Time (mins)|align right,Num Episodes|hidden\r\n"exp_a","90.00",14,100\r\nexp_b,80.00,10,100';
    const base = repoBase(text);
    const p = plan(inlineConfig(), base, wandbRun([['exp_a', 'finished', '720', '91', '100']]));
    const out = rewriteRows(p.tables[0].table.csv, tableChanges(p.tables[0]));
    expect(out).toBe(
      '﻿Experiment,"Correct (%)|align right",Run Time (mins)|align right,Num Episodes|hidden\r\n"exp_a","91.00",12,100\r\nexp_b,80.00,10,100',
    );
  });
});

it('fixtures are readable', () => {
  expect(readFixture('repo_ycb_small.csv')).toContain('Experiment');
});
