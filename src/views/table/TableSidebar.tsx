import { GroupsSection } from '../../components/Sidebar/GroupsSection';
import { SidebarSection } from '../../components/Sidebar/SidebarSection';
import { Checkbox } from '../../components/ui/Checkbox';
import { useAppStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';

/**
 * Table sidebar sections: the group checkboxes (shared with the Overview) and "METRICS · n of m".
 * `session.table.metrics` holds the metric keys the user unchecked (empty = every metric shown);
 * the Overview heatmap hides the same metrics.
 */
export function TableSidebar() {
  const metrics = useAppStore((s) => s.config.active.config.metrics);
  const hidden = useAppStore((s) => s.session.table.metrics);
  const setSession = useAppStore((s) => s.setSession);
  const keys = Object.keys(metrics);
  const shown = keys.filter((k) => !hidden.has(k)).length;

  const toggle = (key: string, checked: boolean) => {
    const next = new Set(hidden);
    if (checked) next.delete(key);
    else next.add(key);
    setSession({ table: { metrics: next } });
  };

  return (
    <>
      <GroupsSection />
      <SidebarSection title="Metrics" aside={`${shown} of ${keys.length}`}>
        {keys.length === 0 ? (
          <p className="text-[12px] text-muted">The config has no metrics.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {keys.map((k) => {
              const m = metrics[k];
              return (
                <Checkbox
                  key={k}
                  checked={!hidden.has(k)}
                  onChange={(c) => toggle(k, c)}
                  label={
                    <span className="flex min-w-0 gap-1">
                      <DisplayName value={m.label || k} />
                      {m.units && <DisplayName value={m.units} className="text-muted" />}
                    </span>
                  }
                />
              );
            })}
          </div>
        )}
      </SidebarSection>
    </>
  );
}
