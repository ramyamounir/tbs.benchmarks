import { BUILTIN_BASE_NAME, builtinVersionOf } from '../config/builtin';
import { DisplayName } from '../util/DisplayName';

/** Version tag of the built-in config, e.g. `v0`. */
export function VersionBadge({ version }: { version: number }) {
  return (
    <span
      title={`Built-in config, version ${version}`}
      className="shrink-0 rounded bg-accent-bg px-1.5 py-px font-sans text-[10px] leading-[14px] font-semibold tracking-wide text-accent"
    >
      <span className="sr-only">version </span>v{version}
    </span>
  );
}

/**
 * A config name. A built-in name (`tbp-default-vN`) is shown as `tbp-default` followed by a
 * version badge; any other name is shown as it is. `className` styles the name text.
 */
export function ConfigName({
  name,
  max,
  className,
}: {
  name: string;
  max?: number;
  className?: string;
}) {
  const version = builtinVersionOf(name);
  if (version === null) return <DisplayName value={name} max={max} className={className} />;
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5" title={name}>
      <DisplayName value={BUILTIN_BASE_NAME} max={max} className={className} />
      <VersionBadge version={version} />
    </span>
  );
}
