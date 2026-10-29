import { DisplayName } from '../util/DisplayName';
import type { ImportOutcome } from './configActions';

const MAX_ISSUES = 10;

/** Inline result of a config import: the error and its first issues, or the warnings count. */
export function ImportMessage({ outcome }: { outcome: ImportOutcome | null }) {
  if (outcome === null) return null;
  if (outcome.ok) {
    return (
      <p role="status" className="mt-2 text-[11px] text-muted">
        {outcome.warnings === 0
          ? 'Imported'
          : `Imported with ${outcome.warnings} ${outcome.warnings === 1 ? 'warning' : 'warnings'}`}
      </p>
    );
  }
  const shown = outcome.issues.slice(0, MAX_ISSUES);
  const more = outcome.issues.length - shown.length;
  return (
    <div role="alert" className="mt-2 min-w-0 text-[11px] text-danger">
      <DisplayName value={outcome.message} className="block" />
      {shown.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {shown.map((issue, i) => (
            <li key={i} className="flex min-w-0 gap-1">
              <span aria-hidden="true">{issue.severity === 'error' ? '×' : '!'}</span>
              <DisplayName value={issue.message} />
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className="mt-0.5">and {more} more</p>}
    </div>
  );
}
