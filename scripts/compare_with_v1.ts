/**
 * Best-effort v1 parity check (spec Phase 2b "v1 parity script"); run with
 *
 *   npx tsx scripts/compare_with_v1.ts --baseline /home/ramy/tbp/tbp.monty \
 *     --run /home/ramy/tbp/tbp.benchmarks/wandb_files/pr_1184.csv
 *
 * Builds the comparison with the app's engine and the built-in config, runs v1 `compare.py` on a
 * trimmed copy of `configs_repo_wandb.yaml` (the unmodified one references the missing
 * `logos_on_objects.csv`), parses both Markdown reports and prints every difference for the
 * (experiment, metric) pairs present in both, then `N mismatches`. Never bundled; never blocks:
 * anything that cannot run prints `not run: <reason>` and exits 0.
 *
 * Process spawning: only `execFileSync` with an argument array (never a shell, never a command
 * string), so paths with spaces, quotes or `$()` reach Python as single literal arguments.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareAll } from '../src/compare/compare';
import { renderMarkdown } from '../src/compare/markdown';
import { builtinConfig } from '../src/config/builtin';
import { buildSource, type SourceFile } from '../src/model/source';

const V1 = '/home/ramy/tbp/tbp.benchmarks';
const VENV_PYTHON = path.join(V1, '.venv/bin/python');

// Equivalent of the documented `-c` program; paths come from sys.argv, never spliced in.
const TRIM_PY = [
  'import sys, yaml',
  'c = yaml.safe_load(open(sys.argv[1]))',
  "del c['files']['logos_on_objects_base']",
  "c['experiments'] = [e for e in c['experiments'] if e['files']['baseline'] != 'logos_on_objects_base']",
  "yaml.safe_dump(c, open(sys.argv[2], 'w'), sort_keys=False, allow_unicode=True)",
].join('\n');

// v1 output names that differ from the v2 metric keys.
const V1_TO_V2: Record<string, string> = { avg_prediction_error: 'prediction_error' };

function notRun(reason: string): never {
  console.log(`not run: ${reason}`);
  process.exit(0);
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

type Row = { base: string; value: string; delta: string; result: string };

/** `### experiment` sections → experiment → metric key → cells (first run column set only). */
function parseMarkdown(md: string): Map<string, Map<string, Row>> {
  const out = new Map<string, Map<string, Row>>();
  let current: Map<string, Row> | null = null;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('### ')) {
      current = new Map();
      out.set(line.slice(4).trim(), current);
      continue;
    }
    if (!current || !line.startsWith('|')) continue;
    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((c) => c.trim());
    if (cells[0] === 'Metric' || cells[0].startsWith('---')) continue;
    const name = cells[0].replace(/\s+\(.*\)$/, '');
    const key = Object.hasOwn(V1_TO_V2, name) ? V1_TO_V2[name] : name;
    current.set(key, { base: cells[1], value: cells[2], delta: cells[3], result: cells[4] });
  }
  return out;
}

function readTree(root: string): SourceFile[] {
  const dir = path.join(root, 'benchmarks');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => {
      const p = path.join(dir, f);
      return {
        path: `${path.basename(root)}/benchmarks/${f}`,
        text: fs.readFileSync(p, 'utf8'),
        lastModified: fs.statSync(p).mtimeMs,
      };
    });
}

function main(): void {
  const baseline = path.resolve(arg('--baseline', '/home/ramy/tbp/tbp.monty'));
  const run = path.resolve(arg('--run', path.join(V1, 'wandb_files/pr_1184.csv')));
  for (const p of [baseline, run]) if (!fs.existsSync(p)) notRun(`missing ${p}`);

  const python = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';
  const compareScript = path.join(V1, 'src/tbp/compare.py');
  if (!fs.existsSync(compareScript)) notRun(`missing ${compareScript}`);

  // Ours.
  const base = buildSource(readTree(baseline), { label: 'Baseline', origin: 'local' });
  const proposed = buildSource(
    [{ path: path.basename(run), text: fs.readFileSync(run, 'utf8'), lastModified: 0 }],
    { label: 'Proposed', origin: 'local' },
  );
  if (!base.source || !proposed.source) notRun('could not build the sources');
  const cmp = compareAll(builtinConfig, base.source, [proposed.source], {});
  const ours = parseMarkdown(
    renderMarkdown(cmp, builtinConfig, { baselineLabel: 'Baseline', runLabels: ['Proposed'] }),
  );

  // v1.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbp-v1-'));
  let v1: Map<string, Map<string, Row>>;
  try {
    const tmpConfig = path.join(tmp, 'v1_trimmed.yaml');
    const outFile = path.join(tmp, 'v1_out.md');
    try {
      execFileSync(
        python,
        ['-I', '-c', TRIM_PY, path.join(V1, 'configs/configs_repo_wandb.yaml'), tmpConfig],
        { cwd: V1, encoding: 'utf8', timeout: 120_000 },
      );
      execFileSync(
        python,
        [
          compareScript,
          '--baseline',
          baseline,
          '--proposed',
          run,
          '--config',
          tmpConfig,
          '--mode',
          'table',
          '--out',
          outFile,
        ],
        {
          cwd: V1,
          encoding: 'utf8',
          timeout: 120_000,
          env: { ...process.env, BASELINE_PATH: baseline, PROPOSED_PATH: run },
        },
      );
    } catch (e) {
      notRun(String((e as Error)?.message ?? e).split('\n')[0]);
    }
    v1 = parseMarkdown(fs.readFileSync(outFile, 'utf8'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const matchMetrics = new Set(
    Object.keys(builtinConfig.metrics).filter(
      (k) => builtinConfig.metrics[k].direction === 'match',
    ),
  );
  let mismatches = 0;
  let compared = 0;
  for (const [experiment, rows] of ours) {
    const theirs = v1.get(experiment);
    if (!theirs) {
      console.log(`v2 only: ${experiment}`);
      continue;
    }
    for (const [metric, mine] of rows) {
      const other = theirs.get(metric);
      if (!other) continue;
      // v1 blanks a whole experiment when either row is missing; v2 shows each cell (documented).
      if (other.base === '—' && other.value === '—') continue;
      compared++;
      const sides: (keyof Row)[] = ['base', 'value', 'delta'];
      // v1 calls a `match` metric better/worse; v2 says same/mismatch (different symbols).
      if (!matchMetrics.has(metric)) sides.push('result');
      for (const side of sides) {
        if (mine[side] !== other[side]) {
          mismatches++;
          console.log(`${experiment}\t${metric}\t${side}\tv1=${other[side]}\tours=${mine[side]}`);
        }
      }
    }
  }
  console.log(`${compared} metric rows compared`);
  console.log(`${mismatches} mismatches`);
}

main();
