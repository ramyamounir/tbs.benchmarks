import { useEffect, useId, useRef, useState } from 'react';
import { MAX_SAVED, MAX_SAVED_NAME } from '../../config/storage';
import type { SavedConfigMeta } from '../../model/types';
import { pickFiles } from '../../sources/drop';
import { useAppStore } from '../../state/store';
import { relativeTime } from '../../util/dates';
import { displayName } from '../../util/displayName';
import { DisplayName } from '../../util/DisplayName';
import { exportConfig, importConfigFromFile, type ImportOutcome } from '../configActions';
import { ImportMessage } from '../ImportMessage';
import { Button } from '../ui/Button';
import { DropMenu } from '../ui/DropMenu';
import { TextInput } from '../ui/TextInput';
import { SidebarSection } from './SidebarSection';

const MINUTE = 60_000;

/** Re-renders every minute so relative times stay current. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(t);
  }, []);
  return now;
}

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

/** One saved entry: Open (or "active"), and a `⋯` menu with Rename / Duplicate / Delete. */
function SavedRow({
  meta,
  active,
  now,
  onDone,
}: {
  meta: SavedConfigMeta;
  active: boolean;
  now: number;
  onDone(): void;
}) {
  const select = useAppStore((s) => s.selectSavedConfig);
  const rename = useAppStore((s) => s.renameSavedConfig);
  const duplicate = useAppStore((s) => s.duplicateSavedConfig);
  const remove = useAppStore((s) => s.deleteSavedConfig);
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [draft, setDraft] = useState(meta.name);
  const errorId = useId();
  const trimmed = draft.trim();
  const error =
    trimmed === ''
      ? 'A name is required'
      : trimmed.length > MAX_SAVED_NAME
        ? `At most ${MAX_SAVED_NAME} characters`
        : null;

  if (mode === 'rename') {
    const commit = () => {
      if (error !== null) return;
      rename(meta.id, trimmed);
      setMode('view');
    };
    return (
      <li className="flex min-w-0 flex-col gap-1 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <TextInput
            value={draft}
            onChange={setDraft}
            mono
            autoFocus
            aria-label="Config name"
            invalid={error !== null}
            aria-describedby={error !== null ? errorId : undefined}
            className="h-7 flex-1 text-[12px]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setDraft(meta.name);
                setMode('view');
              }
            }}
          />
          <Button size="sm" variant="primary" onClick={commit} disabled={error !== null}>
            Save
          </Button>
        </div>
        {error !== null && (
          <p id={errorId} className="text-[11px] text-danger">
            {error}
          </p>
        )}
      </li>
    );
  }

  if (mode === 'delete') {
    return (
      <li className="flex min-w-0 flex-col gap-1 bg-warn-bg px-3 py-1.5" role="group">
        <span className="flex min-w-0 gap-1 text-[12px] text-text">
          Delete <DisplayName value={meta.name} className="font-mono" />?
        </span>
        <span className="flex gap-1.5">
          <Button
            size="sm"
            variant="primary"
            autoFocus
            onClick={() => {
              remove(meta.id);
              setMode('view');
            }}
          >
            Delete
          </Button>
          <Button size="sm" onClick={() => setMode('view')}>
            Cancel
          </Button>
        </span>
      </li>
    );
  }

  return (
    <li className="flex min-w-0 items-center gap-1.5 px-3 py-1.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <DisplayName value={meta.name} className="font-mono text-[12px] text-text" />
        <span className="text-[11px] text-faint">{relativeTime(meta.updatedAt, now)}</span>
      </span>
      {active ? (
        <span className="shrink-0 text-[11px] text-muted">active</span>
      ) : (
        <Button
          size="sm"
          data-saved-item=""
          onClick={() => {
            select(meta.id);
            onDone();
          }}
        >
          Open
        </Button>
      )}
      <DropMenu
        size="sm"
        variant="ghost"
        align="right"
        label={<span aria-hidden="true">⋯</span>}
        ariaLabel={`Actions for ${displayName(meta.name).full}`}
        items={[
          {
            key: 'rename',
            label: 'Rename',
            onSelect: () => {
              setDraft(meta.name);
              setMode('rename');
            },
          },
          { key: 'duplicate', label: 'Duplicate', onSelect: () => duplicate(meta.id) },
          { key: 'delete', label: 'Delete…', onSelect: () => setMode('delete') },
        ]}
      />
    </li>
  );
}

/**
 * "Saved (n)" popover: every saved config with Open and Rename / Duplicate / Delete, "New empty
 * config", "Reset built-in" and the storage footer (spec Phase 4a).
 */
function SavedPopover() {
  const open = useAppStore((s) => s.ui.savedOpen);
  const setOpen = useAppStore((s) => s.setSavedOpen);
  const saved = useAppStore((s) => s.config.saved);
  const activeId = useAppStore((s) => s.config.active.id);
  const newEmpty = useAppStore((s) => s.newEmptyConfig);
  const resetBuiltin = useAppStore((s) => s.resetBuiltinConfig);
  const savedStorageBytes = useAppStore((s) => s.savedStorageBytes);
  // Subscribed so the footer size follows every edit while the popover is open.
  useAppStore((s) => s.config.active.updatedAt);
  const bytes = open ? savedStorageBytes() : 0;
  const root = useRef<HTMLDivElement>(null);
  const now = useNow();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLButtonElement>('[data-saved-item]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <div ref={root} className="relative">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        Saved ({saved.length})
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Saved configs"
          className="absolute top-full right-0 z-30 mt-1 flex max-h-[60vh] w-[240px] flex-col rounded-lg border border-border bg-panel shadow-lg"
        >
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {saved.map((c) => (
              <SavedRow
                key={c.id}
                meta={c}
                active={c.id === activeId}
                now={now}
                onDone={() => setOpen(false)}
              />
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
            <Button size="sm" onClick={newEmpty}>
              New empty config
            </Button>
            <Button size="sm" onClick={resetBuiltin} title="Add a fresh copy of tbp-default">
              Reset built-in
            </Button>
          </div>
          <p className="border-t border-border px-3 py-1.5 text-[11px] text-faint">
            Using {kb(bytes)} of browser storage · {saved.length} of {MAX_SAVED}
          </p>
        </div>
      )}
    </div>
  );
}

/** Config card of the sidebar (every view except Charts): name, save state, Import…, Export ▾, Saved. */
export function ConfigCard() {
  const active = useAppStore((s) => s.config.active);
  const unsaved = useAppStore((s) => s.config.unsaved);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const now = useNow();
  const config = active.config;
  const experiments = config.groups.reduce((n, g) => n + g.experiments.length, 0);
  const metrics = Object.keys(config.metrics).length;

  const onImport = () =>
    pickFiles({ accept: '.yaml,.yml,.json' }, (files) => {
      void importConfigFromFile(files[0]).then(setOutcome);
    });

  return (
    <SidebarSection title="Config" aside={<SavedPopover />}>
      <div className="rounded-lg border border-border bg-panel px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted">
            <FileIcon />
          </span>
          <DisplayName
            value={config.name}
            className="flex-1 font-mono text-[13px] font-semibold text-text"
          />
          <span className="shrink-0 rounded bg-row-alt px-1.5 py-px text-[10px] font-semibold text-muted">
            v2
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-muted">
          {config.groups.length} {config.groups.length === 1 ? 'group' : 'groups'} · {experiments}{' '}
          {experiments === 1 ? 'experiment' : 'experiments'} · {metrics}{' '}
          {metrics === 1 ? 'metric' : 'metrics'}
        </div>
        <div className={`mt-0.5 text-[11px] ${unsaved ? 'text-warn' : 'text-faint'}`}>
          {unsaved
            ? 'Not saved — export to keep it'
            : `Saved in browser · ${relativeTime(active.updatedAt, now)}`}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <Button size="sm" onClick={onImport}>
            Import…
          </Button>
          <DropMenu
            size="sm"
            label="Export ▾"
            ariaLabel="Export config"
            items={[
              { key: 'yaml', label: 'YAML', onSelect: () => exportConfig(config, 'yaml') },
              { key: 'json', label: 'JSON', onSelect: () => exportConfig(config, 'json') },
            ]}
          />
        </div>
        <ImportMessage outcome={outcome} />
      </div>
    </SidebarSection>
  );
}
