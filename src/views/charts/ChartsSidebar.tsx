import { useMemo, useState } from 'react';
import { SidebarSection } from '../../components/Sidebar/SidebarSection';
import { Checkbox } from '../../components/ui/Checkbox';
import { Radio } from '../../components/ui/Radio';
import { SearchInput } from '../../components/ui/SearchInput';
import { Select, type SelectOption } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import type { ChartDef, Config, Direction, Group } from '../../model/types';
import { useAppStore } from '../../state/store';
import { displayName } from '../../util/displayName';
import { DisplayName } from '../../util/DisplayName';
import {
  effectiveSelected,
  selectedExperiments,
  toggleExperiment,
  toggleGroup,
  updateChart,
} from './chartActions';

const TYPES: { value: ChartDef['type']; label: string; description: string }[] = [
  {
    value: 'grouped_bars',
    label: 'Grouped bars',
    description: 'values per experiment, one bar per run',
  },
  {
    value: 'delta_dots',
    label: 'Δ dot plot',
    description: 'difference from baseline, tolerance band',
  },
  { value: 'small_multiples', label: 'Small multiples', description: 'one panel per experiment' },
  { value: 'trend', label: 'Trend across runs', description: 'runs in date order, oldest first' },
];

const DIR_HINT: Record<Direction, string> = {
  higher: '↑ better',
  lower: '↓ better',
  match: '= match',
};

function metricOptions(
  config: Config,
  group: Group | undefined,
  current: string,
): SelectOption<string>[] {
  const inGroup = new Set(group?.metrics ?? []);
  const keys = Object.keys(config.metrics);
  const opts: SelectOption<string>[] = keys.map((k) => {
    const m = config.metrics[k];
    const parts = [
      displayName(m.label).text,
      ...(m.units ? [displayName(m.units).text] : []),
      DIR_HINT[m.direction],
    ];
    return {
      value: k,
      label: inGroup.has(k) ? parts.join(' · ') : `${parts.join(' · ')} (not in group)`,
      disabled: !inGroup.has(k),
    };
  });
  // Sort the group's metrics first, in the group's order.
  const order = (k: string) => (inGroup.has(k) ? group!.metrics.indexOf(k) : 1e6 + keys.indexOf(k));
  opts.sort((a, b) => order(a.value) - order(b.value));
  if (!Object.hasOwn(config.metrics, current)) {
    opts.unshift({
      value: current,
      label: `${displayName(current).text} (unknown)`,
      disabled: true,
    });
  }
  return opts;
}

/**
 * Charts sidebar = inspector of the selected chart (spec Phase 5b): metric, type, experiments
 * (tree of groups; a chart shows one group) and style toggles. Edits go through `updateConfig`.
 */
export function ChartsSidebar() {
  const config = useAppStore((s) => s.config.active.config);
  const selectedRaw = useAppStore((s) => s.session.charts.selected);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const [filter, setFilter] = useState('');
  const selected = effectiveSelected(config, selectedRaw);
  const index = config.charts.findIndex((c) => c.id === selected);
  const chart = index >= 0 ? config.charts[index] : undefined;
  const group = chart ? config.groups.find((g) => g.name === chart.group) : undefined;
  const totalExperiments = config.groups.reduce((n, g) => n + g.experiments.length, 0);
  const sel = useMemo(
    () => (chart ? selectedExperiments(chart, group) : new Set<string>()),
    [chart, group],
  );

  if (!chart) {
    return (
      <SidebarSection title="Chart">
        <p className="text-[12px] text-muted">No chart yet. Use “New chart”.</p>
      </SidebarSection>
    );
  }

  const patch = (p: Partial<Omit<ChartDef, 'id'>>) => {
    if (Object.keys(p).length === 0) return;
    updateConfig((c) => updateChart(c, chart.id, p));
  };
  const q = filter.trim().toLowerCase();
  const tree = config.groups
    .map((g) => {
      const groupHit = q === '' || g.name.toLowerCase().includes(q);
      const exps = [...new Set(g.experiments)].filter(
        (e) => groupHit || e.toLowerCase().includes(q),
      );
      return { g, exps };
    })
    .filter(({ exps, g }) => exps.length > 0 || q === '' || g.name.toLowerCase().includes(q));

  return (
    <>
      <SidebarSection title="Chart" aside={`${index + 1} of ${config.charts.length} selected`}>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[12px] text-muted">
            Metric
            <Select
              value={chart.metric}
              onChange={(metric) => patch({ metric })}
              options={metricOptions(config, group, chart.metric)}
              className="w-full"
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[12px] text-muted">Chart type</legend>
            {TYPES.map((t) => (
              <Radio
                key={t.value}
                name={`chart-type-${chart.id}`}
                checked={chart.type === t.value}
                onChange={() => patch({ type: t.value })}
                label={t.label}
                description={t.description}
              />
            ))}
          </fieldset>
        </div>
      </SidebarSection>
      <SidebarSection title="Experiments" aside={`${sel.size} of ${totalExperiments}`}>
        <SearchInput
          value={filter}
          onChange={setFilter}
          placeholder="Filter or pick a group…"
          shortcut
          className="mb-2"
        />
        <ul className="flex flex-col gap-1.5">
          {tree.map(({ g, exps }) => {
            const own = g.name === chart.group;
            const uniq = new Set(g.experiments);
            const count = own ? sel.size : 0;
            const all = own && uniq.size > 0 && count === uniq.size;
            return (
              <li key={g.name} className="flex flex-col gap-1.5">
                <Checkbox
                  checked={all}
                  indeterminate={own && count > 0 && !all}
                  onChange={(v) => patch(toggleGroup(config, chart, g, v))}
                  label={<DisplayName value={g.name} className="font-medium" />}
                  aside={own ? `${count}/${uniq.size}` : `${uniq.size}`}
                />
                {exps.length > 0 && (
                  <ul className="flex flex-col gap-1.5 pl-5">
                    {exps.map((e) => (
                      <li key={e}>
                        <Checkbox
                          checked={own && sel.has(e)}
                          onChange={(v) => patch(toggleExperiment(config, chart, g, e, v))}
                          label={<DisplayName value={e} className="font-mono text-[12px]" />}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {tree.length === 0 && (
            <li className="text-[12px] text-muted">No group or experiment matches.</li>
          )}
        </ul>
      </SidebarSection>
      <SidebarSection title="Style">
        <div className="flex flex-col gap-2.5">
          <Toggle
            label="Tolerance band"
            checked={chart.options.toleranceBand}
            onChange={(v) => patch({ options: { ...chart.options, toleranceBand: v } })}
          />
          <Toggle
            label="Show Δ labels"
            checked={chart.options.deltaLabels}
            onChange={(v) => patch({ options: { ...chart.options, deltaLabels: v } })}
          />
          <Toggle
            label="Y axis from zero"
            checked={chart.options.yFromZero}
            onChange={(v) => patch({ options: { ...chart.options, yFromZero: v } })}
          />
        </div>
      </SidebarSection>
    </>
  );
}
