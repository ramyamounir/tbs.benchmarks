import { useId, useState } from 'react';
import {
  DEFAULT_REF,
  DEFAULT_REPO,
  loadGithubSource,
  validateGithubInput,
} from '../sources/github';
import { runLoad } from '../sources/runLoad';
import { githubRefKey, useAppStore } from '../state/store';
import { Button } from './ui/Button';
import { TextInput } from './ui/TextInput';

/**
 * Repository + ref inputs and the load button (Start "Baseline from GitHub" card and the GitHub
 * modal). Input is validated before any request; the resolved-ref cache skips one API call and is
 * filled as soon as the ref resolves, so a load that fails later does not resolve again on retry.
 */
export function GithubForm({
  role,
  onStarted,
}: {
  role: 'baseline' | 'run';
  onStarted?: () => void;
}) {
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [ref, setRef] = useState(DEFAULT_REF);
  const id = useId();
  const valid = validateGithubInput(repo, ref);
  const cached = useAppStore((s) =>
    valid ? s.session.github[githubRefKey(valid.owner, valid.repo, valid.ref)] : undefined,
  );
  const loading = useAppStore((s) => s.sources.loading !== null);

  const load = () => {
    if (!valid) return;
    const cachedRef =
      useAppStore.getState().session.github[githubRefKey(valid.owner, valid.repo, valid.ref)];
    const { owner, repo: r, ref: f } = valid;
    void runLoad(role, `${r}@${f}`, (signal, onProgress, onWait) =>
      loadGithubSource(repo, ref, signal, {
        onProgress,
        onWait,
        cachedRef,
        onResolved: (resolved) => useAppStore.getState().rememberGithubRef(owner, r, f, resolved),
      }),
    );
    onStarted?.();
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        load();
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] text-muted" htmlFor={`${id}-repo`}>
        Repository
        <TextInput
          id={`${id}-repo`}
          mono
          value={repo}
          onChange={setRepo}
          placeholder="owner/repo"
          invalid={!valid && repo.trim() !== ''}
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted" htmlFor={`${id}-ref`}>
        Branch, tag or commit
        <span className="relative flex">
          <TextInput
            id={`${id}-ref`}
            mono
            value={ref}
            onChange={setRef}
            placeholder="main"
            className="w-full pr-[120px]"
          />
          {cached && (
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-[11px] text-faint">
              latest: {cached.sha.slice(0, 7)}
            </span>
          )}
        </span>
      </label>
      {!valid && (
        <p role="alert" className="text-[11px] text-danger">
          Invalid owner/repo or ref
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={!valid}
        className="w-full"
        aria-busy={loading || undefined}
      >
        {role === 'baseline' ? 'Load baseline' : 'Load run'}
      </Button>
      <p className="text-center text-[11px] text-faint">
        Only these files are requested from GitHub
      </p>
    </form>
  );
}
