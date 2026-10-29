import { useAppStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { Checkbox } from '../ui/Checkbox';
import { SidebarSection } from './SidebarSection';

/**
 * "BENCHMARK GROUPS · n of m" checkboxes, shared by the Overview and the Table (one visibility for
 * both). `session.overview.groups` holds the groups the user unchecked (empty = every group
 * shown), so new or renamed groups show by default.
 */
export function GroupsSection() {
  const groups = useAppStore((s) => s.config.active.config.groups);
  const hidden = useAppStore((s) => s.session.overview.groups);
  const setSession = useAppStore((s) => s.setSession);
  const shown = groups.filter((g) => !hidden.has(g.name)).length;

  const toggleGroup = (name: string, checked: boolean) => {
    const next = new Set(hidden);
    if (checked) next.delete(name);
    else next.add(name);
    setSession({ overview: { groups: next } });
  };

  return (
    <SidebarSection title="Benchmark groups" aside={`${shown} of ${groups.length}`}>
      {groups.length === 0 ? (
        <p className="text-[12px] text-muted">The config has no groups.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {groups.map((g, i) => (
            <Checkbox
              key={`${i}\u0000${g.name}`}
              checked={!hidden.has(g.name)}
              onChange={(c) => toggleGroup(g.name, c)}
              label={<DisplayName value={g.name} className="font-mono" />}
              aside={g.experiments.length}
            />
          ))}
        </div>
      )}
    </SidebarSection>
  );
}
