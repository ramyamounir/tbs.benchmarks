import { useEffect, useEffectEvent, useId, useState, type ReactNode } from 'react';
import { compileMatchRegex } from '../../compare/safeRegex';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { TextInput } from '../../components/ui/TextInput';
import type { MatchMode } from '../../model/types';

/*
 * Inputs that follow the spec's "Editor input rule" (Phase 4a): the text lives in a local draft,
 * a draft that fails validation is shown with its reason inline in `--danger` (aria-invalid +
 * aria-describedby) and is never committed; only valid values reach `updateConfig`.
 */

/** Visible focus ring of every focusable chip/row of the Config view (`--accent`, 2 px). */
export const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-accent';

/** Debounce of the regex fields (spec: 300 ms after typing stops). */
export const REGEX_DEBOUNCE_MS = 300;

/** Starting pattern when the user switches a match mode to regex. */
export const DEFAULT_MATCH_REGEX = '^{name}(_[a-z0-9]{8})?$';

/**
 * Text field with a draft: commits on Enter or blur when `validate(draft)` returns null and the
 * draft differs from `value`; `Esc` reverts. The draft follows `value` when it changes outside.
 */
export function DraftInput({
  value,
  validate,
  onCommit,
  label,
  mono = false,
  placeholder,
  className,
  inputClassName,
}: {
  value: string;
  validate(draft: string): string | null;
  onCommit(draft: string): void;
  label: string;
  mono?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  const errorId = useId();
  if (prev !== value) {
    // Derived-state reset (React's documented render-time pattern): an outside change wins.
    setPrev(value);
    setDraft(value);
  }
  const error = draft === value ? null : validate(draft);
  const commit = () => {
    if (draft !== value && validate(draft) === null) onCommit(draft);
  };
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className ?? ''}`}>
      <TextInput
        value={draft}
        onChange={setDraft}
        mono={mono}
        placeholder={placeholder}
        aria-label={label}
        invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        className={`w-full ${inputClassName ?? ''}`}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape' && draft !== value) {
            e.stopPropagation();
            setDraft(value);
          }
        }}
      />
      {error !== null && (
        <p id={errorId} className="text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type ModeValue = 'suffix' | 'exact' | 'regex';

/**
 * "Match names" control: exact or run-id suffix / exact / regex… with a pattern input. The pattern
 * keeps a local draft; 300 ms after typing stops it is compiled with `compileMatchRegex(draft,
 * testName)`: valid → committed (and `count` shown as "matches n rows"), invalid → the error is
 * shown inline, nothing is committed and the count is not run. With `inherit`, `value` may be
 * undefined ("use each source's default"), shown with `inheritHint` and a reset link.
 */
export function MatchModeEditor({
  value,
  onCommit,
  testName,
  count,
  inherit = false,
  inheritHint,
  label,
}: {
  value: MatchMode | undefined;
  onCommit(mode: MatchMode | undefined): void;
  testName: string;
  /** "matches n rows" for a valid committed pattern; null hides the count. */
  count?: (regex: string) => number | null;
  inherit?: boolean;
  inheritHint?: ReactNode;
  label: string;
}) {
  const committedRegex = typeof value === 'object' ? value.regex : null;
  const [regexMode, setRegexMode] = useState(committedRegex !== null);
  const [draft, setDraft] = useState(committedRegex ?? DEFAULT_MATCH_REGEX);
  const [error, setError] = useState<string | null>(null);
  const [prev, setPrev] = useState(committedRegex);
  const errorId = useId();
  if (prev !== committedRegex) {
    setPrev(committedRegex);
    if (committedRegex !== null) {
      setDraft(committedRegex);
      setRegexMode(true);
    }
  }

  const commitRegex = useEffectEvent((pattern: string) => {
    const compiled = compileMatchRegex(pattern, testName);
    if ('error' in compiled) {
      setError(compiled.error);
      return;
    }
    setError(null);
    if (pattern !== committedRegex) onCommit({ regex: pattern });
  });

  useEffect(() => {
    if (!regexMode) return;
    const t = setTimeout(() => commitRegex(draft), REGEX_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, regexMode]);

  const selected: ModeValue | '' = regexMode
    ? 'regex'
    : value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : 'regex';

  const n = regexMode && error === null && committedRegex === draft && count ? count(draft) : null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <SegmentedControl<ModeValue>
        dense
        ariaLabel={label}
        value={selected as ModeValue}
        onChange={(v) => {
          if (v === 'regex') {
            setRegexMode(true);
            return;
          }
          setRegexMode(false);
          setError(null);
          onCommit(v);
        }}
        options={[
          { value: 'suffix', label: 'exact or run-id suffix' },
          { value: 'exact', label: 'exact' },
          { value: 'regex', label: 'regex…' },
        ]}
      />
      {regexMode && (
        <div className="flex min-w-0 flex-col gap-1">
          <TextInput
            value={draft}
            onChange={setDraft}
            mono
            aria-label={`${label} pattern`}
            placeholder="^{name}(_[a-z0-9]{8})?$"
            invalid={error !== null}
            aria-describedby={error !== null ? errorId : undefined}
            className="w-full"
          />
          {error !== null ? (
            <p id={errorId} className="text-[11px] text-danger">
              {error}
            </p>
          ) : (
            <p className="text-[11px] text-muted">
              <span className="font-mono">{'{name}'}</span> is the experiment name
              {n !== null && ` · matches ${n} ${n === 1 ? 'row' : 'rows'}`}
            </p>
          )}
        </div>
      )}
      {inherit && value === undefined && !regexMode && (
        <p className="text-[11px] text-muted">{inheritHint}</p>
      )}
      {inherit && value !== undefined && (
        <button
          type="button"
          className={`self-start text-[11px] text-accent hover:underline ${FOCUS_RING}`}
          onClick={() => {
            setRegexMode(false);
            setError(null);
            onCommit(undefined);
          }}
        >
          Use the source defaults
        </button>
      )}
    </div>
  );
}
