import { GroupsSection } from '../../components/Sidebar/GroupsSection';
import { SidebarSection } from '../../components/Sidebar/SidebarSection';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Toggle } from '../../components/ui/Toggle';
import { useAppStore } from '../../state/store';

/** Overview sidebar sections: the shared group checkboxes and the Show / Cell color options. */
export function OverviewSidebar() {
  const ov = useAppStore((s) => s.session.overview);
  const setSession = useAppStore((s) => s.setSession);

  return (
    <>
      <GroupsSection />
      <SidebarSection title="Show">
        <div className="flex flex-col gap-2.5">
          <Toggle
            label="Only rows with regressions"
            checked={ov.onlyRegressions}
            onChange={(v) => setSession({ overview: { onlyRegressions: v } })}
          />
          <Toggle
            label="Hide metrics within tolerance"
            checked={ov.hideWithinTol}
            onChange={(v) => setSession({ overview: { hideWithinTol: v } })}
          />
          <Toggle
            label="Include missing experiments"
            checked={ov.includeMissing}
            onChange={(v) => setSession({ overview: { includeMissing: v } })}
          />
        </div>
        <div className="mt-4 mb-1.5 text-[12px] text-text">Cell color</div>
        <SegmentedControl
          ariaLabel="Cell color"
          value={ov.cellColor}
          onChange={(v) => setSession({ overview: { cellColor: v } })}
          options={[
            {
              value: 'tolerance',
              label: 'Δ ÷ tolerance',
              title: 'Intensity by |Δ| relative to the tolerance',
            },
            {
              value: 'percent',
              label: 'Δ %',
              title: 'Intensity by |Δ| as a percentage of the baseline',
            },
          ]}
          className="w-full"
        />
      </SidebarSection>
    </>
  );
}
