import { useAppStore } from '../state/store';
import { DisplayName } from '../util/DisplayName';
import { exportConfig } from './configActions';
import { Button } from './ui/Button';

/**
 * "Not saved" banner under the top bar (spec Phase 3 "Saved-config persistence" → "Refused
 * writes"). Persistent until dismissed; never moves focus.
 */
export function StorageBanner() {
  const banner = useAppStore((s) => s.ui.banner);
  const config = useAppStore((s) => s.config.active.config);
  const dismiss = useAppStore((s) => s.dismissBanner);
  if (banner === null) return null;
  return (
    <div
      role="alert"
      className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warn bg-warn-bg px-4 py-2 text-[13px] text-warn"
    >
      <span aria-hidden="true" className="shrink-0 font-semibold">
        !
      </span>
      <p className="flex min-w-0 flex-1 basis-[220px] flex-wrap gap-x-1">
        {banner.kind === 'storage-unavailable' ? (
          'Not saved: browser storage is unavailable in this window — export your config to keep it'
        ) : (
          <>
            <span>Not saved: browser storage is full or the config is too large — export it</span>
            {banner.name !== undefined && (
              <span className="flex min-w-0">
                (saved config “<DisplayName value={banner.name} />” is too large; delete it or
                export it)
              </span>
            )}
          </>
        )}
      </p>
      <Button size="sm" onClick={() => exportConfig(config, 'yaml')}>
        Export YAML
      </Button>
      <Button size="sm" variant="ghost" onClick={dismiss}>
        Dismiss
      </Button>
    </div>
  );
}
