import { describe, expect, it } from 'vitest';
import { builtinConfigCopy } from '../../config/builtin';
import { smallBaseline, smallRun } from '../../fixtures/files';
import { emptyConfig, type Config } from '../../model/types';
import {
  WANDB_ONLY,
  addExperiments,
  assignColumn,
  clickSelection,
  columnUsers,
  columnsByKind,
  duplicateGroup,
  filesModel,
  filterFiles,
  groupNameError,
  metricMissingInBaseline,
  moveItem,
  newGroup,
  newMetric,
  parseNames,
  presenceIn,
  regexMatchCount,
  tableOptions,
  listSeparator,
  unassignedSourceLabels,
} from './model';

function config(): Config {
  return builtinConfigCopy();
}

describe('filesModel', () => {
  it('lists repo experiments per table and wandb-only runs without their run id', () => {
    const base = smallBaseline();
    const run = smallRun();
    const cfg = emptyConfig();
    const m = filesModel(cfg, [base, run]);
    expect(m.sections.map((s) => s.id)).toEqual([
      'benchmarks/ycb_10objs.csv',
      'benchmarks/montymeetsworld.csv',
      WANDB_ONLY,
    ]);
    expect(m.sections[2].rows.map((r) => r.name)).toEqual(['dark_world_image_on_scanned_model']);
    expect(m.sections[2].rows[0].presence).toEqual([false, true]);
    expect(m.sections[0].rows.map((r) => r.name)).toEqual([
      'base_config_10distinctobj_dist_agent',
      'base_config_10distinctobj_surf_agent',
      'randrot_noise_10distinctobj_dist_agent',
    ]);
    // present in the baseline; in the wandb run through the run-id suffix rule
    expect(m.sections[0].rows[0].presence).toEqual([true, true]);
    expect(m.sections[0].rows[2].presence).toEqual([true, false]);
    expect(m.total).toBe(6);
    expect(m.unassigned).toBe(6);
    expect(m.assigned).toBe(0);
  });

  it('marks assigned names and puts unmatched wandb runs in a wandb-only section', () => {
    const run = smallRun();
    const cfg = emptyConfig();
    cfg.groups.push({
      name: 'g',
      table: null,
      metrics: [],
      column_overrides: {},
      experiments: ['base_config_10distinctobj_dist_agent'],
    });
    const m = filesModel(cfg, [run]);
    expect(m.sections).toHaveLength(1);
    expect(m.sections[0].id).toBe(WANDB_ONLY);
    const names = m.sections[0].rows.map((r) => r.name);
    expect(names).toContain('base_config_10distinctobj_dist_agent');
    expect(names).toContain('base_config_10distinctobj_surf_agent'); // two runs, one name
    expect(new Set(names).size).toBe(names.length);
    expect(m.assigned).toBe(1);
    expect(unassignedSourceLabels(m, [run])).toEqual(['Proposed']);
  });

  it('separates the "Found in" source list as prose with a spaced "and"', () => {
    const join = (labels: string[]) =>
      labels.map((l, i) => l + listSeparator(i, labels.length)).join(' ');
    expect(join(['a.csv'])).toBe('a.csv');
    expect(join(['a.csv', 'b.csv'])).toBe('a.csv and b.csv');
    expect(join(['a.csv', 'b.csv', 'c.csv'])).toBe('a.csv, b.csv and c.csv');
    expect(listSeparator(0, 2)).toBe(' and'); // the leading space must survive rendering
  });

  it('filters by assignment and text', () => {
    const cfg = emptyConfig();
    cfg.groups.push({
      name: 'g',
      table: null,
      metrics: [],
      column_overrides: {},
      experiments: ['base_config_10distinctobj_dist_agent'],
    });
    const m = filesModel(cfg, [smallBaseline()]);
    expect(
      filterFiles(m.sections, 'assigned', '').flatMap((s) => s.rows.map((r) => r.name)),
    ).toEqual(['base_config_10distinctobj_dist_agent']);
    expect(filterFiles(m.sections, 'unassigned', 'WORLD').flatMap((s) => s.rows)).toHaveLength(2);
    expect(filterFiles(m.sections, 'unassigned', 'surf').flatMap((s) => s.rows)).toHaveLength(1);
    expect(filterFiles(m.sections, 'all', 'nothing')).toEqual([]);
  });
});

describe('clickSelection', () => {
  const visible = ['a', 'b', 'c', 'd', 'e'];
  const plain = { shift: false, toggle: false };
  it('plain click selects only the name', () => {
    expect(clickSelection(['a', 'b'], 'c', plain, visible)).toEqual(['c']);
  });
  it('ctrl/cmd toggles', () => {
    expect(clickSelection(['a'], 'c', { shift: false, toggle: true }, visible)).toEqual(['a', 'c']);
    expect(clickSelection(['a', 'c'], 'a', { shift: false, toggle: true }, visible)).toEqual(['c']);
  });
  it('shift adds the visible range from the last-selected name', () => {
    expect(clickSelection(['b'], 'd', { shift: true, toggle: false }, visible)).toEqual([
      'b',
      'c',
      'd',
    ]);
    expect(clickSelection(['e', 'd'], 'b', { shift: true, toggle: false }, visible)).toEqual([
      'e',
      'd',
      'c',
      'b',
    ]);
    // anchor no longer visible → plain selection
    expect(clickSelection(['x'], 'b', { shift: true, toggle: false }, visible)).toEqual(['b']);
    expect(clickSelection([], 'b', { shift: true, toggle: false }, visible)).toEqual(['b']);
  });
});

describe('parseNames', () => {
  it('splits by newlines and commas, trims, deduplicates', () => {
    expect(parseNames(' a \r\nb,c\n\n a ,')).toEqual(['a', 'b', 'c']);
    expect(parseNames('  ')).toEqual([]);
  });
});

describe('group edits', () => {
  it('addExperiments appends and moves names out of other groups', () => {
    const cfg = config();
    const from = cfg.groups[0];
    const moved = from.experiments[0];
    const r = addExperiments(cfg, cfg.groups[1].name, [moved, 'new_exp', 'new_exp']);
    expect('config' in r).toBe(true);
    if (!('config' in r)) return;
    expect(r.config.groups[1].experiments.slice(-2)).toEqual([moved, 'new_exp']);
    expect(r.config.groups[0].experiments).not.toContain(moved);
    expect(cfg.groups[0].experiments).toContain(moved); // input untouched
  });

  it('addExperiments refuses beyond the per-group cap and skips over-long names', () => {
    const cfg = emptyConfig();
    cfg.groups.push({
      name: 'g',
      table: null,
      metrics: [],
      column_overrides: {},
      experiments: Array.from({ length: 5000 }, (_, i) => `e${i}`),
    });
    expect(addExperiments(cfg, 'g', ['x'])).toEqual({
      error: 'A group holds at most 5000 experiments',
    });
    expect(addExperiments(cfg, 'nope', ['x'])).toEqual({ error: 'No group selected' });
    cfg.groups[0].experiments = [];
    const r = addExperiments(cfg, 'g', ['x'.repeat(513), 'ok']);
    expect('config' in r && r.config.groups[0].experiments).toEqual(['ok']);
    expect('config' in r && r.message).toMatch(/skipped/);
  });

  it('moveItem moves within range only', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 0, 3)).toEqual(['a', 'b', 'c']);
  });

  it('newGroup picks the first unused baseline table and a unique name', () => {
    const cfg = emptyConfig();
    const base = smallBaseline();
    const r1 = newGroup(cfg, base);
    expect('config' in r1 && r1.config.groups[0]).toMatchObject({
      name: 'ycb_10objs',
      table: 'benchmarks/ycb_10objs.csv',
    });
    if (!('config' in r1)) return;
    const r2 = newGroup(r1.config, base);
    expect('config' in r2 && r2.config.groups[1].table).toBe('benchmarks/montymeetsworld.csv');
    if (!('config' in r2)) return;
    const r3 = newGroup(r2.config, base);
    expect('config' in r3 && r3.config.groups[2]).toMatchObject({ name: 'new_group', table: null });
    const full = emptyConfig();
    full.groups = Array.from({ length: 100 }, (_, i) => ({
      name: `g${i}`,
      table: null,
      metrics: [],
      column_overrides: {},
      experiments: [],
    }));
    expect('error' in newGroup(full, null)).toBe(true);
  });

  it('duplicateGroup copies everything but the experiments, right after the original', () => {
    const cfg = config();
    const r = duplicateGroup(cfg, cfg.groups[0].name);
    if (!('config' in r)) throw new Error('refused');
    expect(r.config.groups[1].name).toBe(`${cfg.groups[0].name}_copy`);
    expect(r.config.groups[1].experiments).toEqual([]);
    expect(r.config.groups[1].metrics).toEqual(cfg.groups[0].metrics);
  });

  it('groupNameError applies the editor input rule', () => {
    const cfg = config();
    const [a, b] = cfg.groups.map((g) => g.name);
    expect(groupNameError(cfg, a, '  ')).toMatch(/needs a name/);
    expect(groupNameError(cfg, a, 'x'.repeat(513))).toMatch(/512/);
    expect(groupNameError(cfg, a, b)).toMatch(/already/);
    expect(groupNameError(cfg, a, a)).toBeNull();
    expect(groupNameError(cfg, a, 'fresh')).toBeNull();
  });

  it('newMetric creates a unique valid key', () => {
    const cfg = emptyConfig();
    const r1 = newMetric(cfg);
    expect(r1.key).toBe('metric');
    if (!('config' in r1)) return;
    expect(newMetric(r1.config).key).toBe('metric_2');
  });
});

describe('presence and matching', () => {
  it('presenceIn finds duplicate rows and honours a valid row choice', () => {
    const cfg = config();
    const run = smallRun();
    const g = cfg.groups.find((x) => x.table === 'benchmarks/ycb_10objs.csv');
    if (!g) throw new Error('fixture group');
    const name = 'base_config_10distinctobj_surf_agent';
    const p = presenceIn(cfg, g, run, name, {});
    expect(p.candidates).toEqual([1, 2]);
    expect(p.chosen).toBe(1);
    expect(p.override).toBe(false);
    const key = `${run.id}\u0000${run.tables[0].path}\u0000${name}`;
    expect(presenceIn(cfg, g, run, name, { [key]: 2 })).toMatchObject({
      chosen: 2,
      override: true,
    });
    // a stale choice falls back to the first match
    expect(presenceIn(cfg, g, run, name, { [key]: 0 })).toMatchObject({
      chosen: 1,
      override: false,
    });
    expect(presenceIn(cfg, g, run, 'nope', {}).candidates).toEqual([]);
  });

  it('regexMatchCount sums the matched baseline rows', () => {
    const cfg = config();
    const base = smallBaseline();
    const g = cfg.groups.find((x) => x.table === 'benchmarks/ycb_10objs.csv');
    if (!g) throw new Error('fixture group');
    expect(regexMatchCount(cfg, g, base, '^{name}$')).toBe(3);
    // exact matches win before the regex (engine rule); a rejected pattern matches nothing
    expect(regexMatchCount(cfg, g, base, '(a+)+')).toBe(0);
  });

  it('metricMissingInBaseline flags a metric whose column the baseline table lacks', () => {
    const cfg = config();
    const base = smallBaseline();
    const g = cfg.groups.find((x) => x.table === 'benchmarks/montymeetsworld.csv');
    if (!g) throw new Error('fixture group');
    expect(metricMissingInBaseline(cfg, g, 'percent_correct', base)).toBe(false);
    expect(metricMissingInBaseline(cfg, g, 'rotation_error', base)).toBe(true);
    expect(metricMissingInBaseline(cfg, g, 'rotation_error', null)).toBe(false);
  });
});

describe('columns and tables', () => {
  it('columnsByKind and columnUsers', () => {
    const cfg = config();
    const cols = columnsByKind([smallBaseline(), smallRun()]);
    expect(cols.repo[0]).toBe('Experiment');
    expect(cols.repo).toContain('Rotation Error (degrees)|align right');
    expect(cols.wandb).toContain('LM_2/overall/avg_rotation_error');
    expect(columnUsers(cfg, 'repo', 'Correct (%)|align right')).toEqual(['percent_correct']);
    expect(columnUsers(cfg, 'repo', 'Experiment')).toEqual([]);
  });

  it('assignColumn keeps the transforms of that kind', () => {
    const cfg = config();
    const before = cfg.metrics.rotation_error.columns.wandb?.transforms;
    const r = assignColumn(cfg, 'rotation_error', 'wandb', 'LM_2/overall/avg_rotation_error');
    if (!('config' in r)) throw new Error('refused');
    expect(r.config.metrics.rotation_error.columns.wandb).toEqual({
      column: 'LM_2/overall/avg_rotation_error',
      transforms: before,
    });
    expect(Object.keys(r.config.metrics)).toEqual(Object.keys(cfg.metrics));
    expect(assignColumn(cfg, 'nope', 'repo', 'x')).toEqual({ error: 'Select a metric first' });
  });

  it('tableOptions lists loaded tables first, then the config tables not loaded', () => {
    const cfg = config();
    const opts = tableOptions(cfg, [smallBaseline()]);
    expect(opts.slice(0, 2)).toEqual([
      { path: 'benchmarks/ycb_10objs.csv', loaded: true },
      { path: 'benchmarks/montymeetsworld.csv', loaded: true },
    ]);
    expect(opts.slice(2).every((o) => !o.loaded)).toBe(true);
    expect(opts).toHaveLength(7);
  });
});
