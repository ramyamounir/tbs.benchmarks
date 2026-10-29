import { buildSource, type SourceFile } from '../model/source';
import type { LoadError, Source } from '../model/types';

/**
 * Baseline / run from GitHub (spec Phase 3 "GitHub request safety"). The ONLY module that calls
 * `fetch`. Every input is validated before a request, every URL is built from validated, encoded
 * segments to two fixed origins, every response is shape-checked, and response bodies are never
 * shown or stored. No tokens, no private repos.
 */

export const DEFAULT_REPO = 'thousandbrainsproject/tbp.monty';
export const DEFAULT_REF = 'main';

export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  'https://api.github.com',
  'https://raw.githubusercontent.com',
]);

const MB = 1024 * 1024;
export const GITHUB_MAX_FILES = 50;
export const GITHUB_MAX_FILE_BYTES = 50 * MB;
export const GITHUB_MAX_TOTAL_BYTES = 200 * MB;

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,127}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const NAME_RE = /^[A-Za-z0-9._ -]{1,100}\.csv$/;

const UNEXPECTED = 'unexpected GitHub response';
const NOT_FOUND = 'repo/ref/benchmarks not found';
const INVALID_INPUT = 'Invalid owner/repo or ref';

export interface GithubInput {
  owner: string;
  repo: string;
  ref: string;
}

export function validateGithubInput(ownerRepo: string, ref: string): GithubInput | null {
  const or = ownerRepo.trim();
  const r = ref.trim();
  const parts = or.split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!OWNER_RE.test(owner)) return null;
  if (!REPO_RE.test(repo) || repo === '.' || repo === '..') return null;
  if (!REF_RE.test(r)) return null;
  if (r.includes('..') || r.includes('//') || r.includes('@{')) return null;
  if (r.endsWith('/') || r.endsWith('.lock')) return null;
  return { owner, repo, ref: r };
}

/** Thrown for a 403/429 with `x-ratelimit-remaining: 0`; `resetAt` is epoch ms or null. */
export class GitHubRateLimited extends Error {
  readonly resetAt: number | null;
  constructor(resetAt: number | null) {
    super('GitHub rate limit reached');
    this.name = 'GitHubRateLimited';
    this.resetAt = resetAt;
  }
}

/** Every other GitHub failure, with the LoadError reason it maps to. Messages are fixed strings. */
export class GitHubError extends Error {
  readonly reason: LoadError['reason'];
  constructor(reason: LoadError['reason'], message: string) {
    super(message);
    this.name = 'GitHubError';
    this.reason = reason;
  }
}

// ---- URL construction (nothing else concatenates GitHub URLs) ----

const enc = encodeURIComponent;

function commitsUrl(owner: string, repo: string, ref: string): string {
  const refPath = ref.split('/').map(enc).join('/');
  return `https://api.github.com/repos/${enc(owner)}/${enc(repo)}/commits/${refPath}`;
}

function contentsUrl(owner: string, repo: string, sha: string): string {
  return `https://api.github.com/repos/${enc(owner)}/${enc(repo)}/contents/benchmarks?ref=${enc(sha)}`;
}

function rawUrl(owner: string, repo: string, sha: string, name: string): string {
  return `https://raw.githubusercontent.com/${enc(owner)}/${enc(repo)}/${enc(sha)}/benchmarks/${enc(name)}`;
}

function originOk(url: string): boolean {
  try {
    return ALLOWED_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

function rateLimitReset(res: Response): number | null {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  return Number.isFinite(reset) && reset > 0 ? reset * 1000 : null;
}

/** The one place `fetch` is called. Checks the origin before and after, maps HTTP failures. */
async function ghFetch(url: string, signal: AbortSignal, api: boolean): Promise<Response> {
  if (!originOk(url)) throw new GitHubError('network', UNEXPECTED);
  const res = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'follow',
    cache: 'no-cache',
    signal,
    headers: api ? { Accept: 'application/vnd.github+json' } : {},
  });
  if (!originOk(res.url || url)) throw new GitHubError('network', UNEXPECTED);
  if (res.ok) return res;
  if (
    (res.status === 403 || res.status === 429) &&
    res.headers.get('x-ratelimit-remaining') === '0'
  ) {
    throw new GitHubRateLimited(rateLimitReset(res));
  }
  if (res.status === 404) throw new GitHubError('not-found', NOT_FOUND);
  // The body (JSON message, HTML error page) is never read or shown.
  throw new GitHubError('network', `GitHub request failed (HTTP ${res.status})`);
}

async function json(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new GitHubError('network', UNEXPECTED);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export async function resolveRef(
  owner: string,
  repo: string,
  ref: string,
  signal: AbortSignal,
): Promise<{ sha: string; date: string }> {
  const body = await json(await ghFetch(commitsUrl(owner, repo, ref), signal, true));
  if (!isObj(body)) throw new GitHubError('network', UNEXPECTED);
  const sha = body.sha;
  const commit = body.commit;
  const committer = isObj(commit) ? commit.committer : undefined;
  const date = isObj(committer) ? committer.date : undefined;
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new GitHubError('network', UNEXPECTED);
  if (typeof date !== 'string' || !Number.isFinite(Date.parse(date))) {
    throw new GitHubError('network', UNEXPECTED);
  }
  return { sha, date };
}

export async function listBenchmarks(
  owner: string,
  repo: string,
  sha: string,
  signal: AbortSignal,
): Promise<{ names: string[]; errors: LoadError[] }> {
  const body = await json(await ghFetch(contentsUrl(owner, repo, sha), signal, true));
  if (!Array.isArray(body)) throw new GitHubError('network', UNEXPECTED);
  const names: string[] = [];
  const errors: LoadError[] = [];
  let total = 0;
  for (const entry of body as unknown[]) {
    // Only `type`, `name` and `size` are read; download_url, path, url and _links never are.
    if (!isObj(entry) || entry.type !== 'file') continue;
    const name = entry.name;
    if (typeof name !== 'string' || !NAME_RE.test(name)) continue;
    const size = entry.size;
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) continue;
    if (size > GITHUB_MAX_FILE_BYTES) {
      errors.push({ file: name, message: 'File too large (> 50 MB)', reason: 'too-large' });
      continue;
    }
    names.push(name);
    total += size;
  }
  if (names.length > GITHUB_MAX_FILES) {
    throw new GitHubError('too-many', `Too many CSV files (> ${GITHUB_MAX_FILES})`);
  }
  if (total > GITHUB_MAX_TOTAL_BYTES) {
    throw new GitHubError('too-large', 'Files too large in total (> 200 MB)');
  }
  return { names, errors };
}

export async function fetchTable(
  owner: string,
  repo: string,
  sha: string,
  name: string,
  signal: AbortSignal,
): Promise<string> {
  if (!SHA_RE.test(sha) || !NAME_RE.test(name)) throw new GitHubError('network', UNEXPECTED);
  const res = await ghFetch(rawUrl(owner, repo, sha, name), signal, false);
  const length = Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length > GITHUB_MAX_FILE_BYTES) {
    throw new GitHubError('too-large', 'File too large (> 50 MB)');
  }
  const text = await res.text();
  if (text.length > GITHUB_MAX_FILE_BYTES) {
    throw new GitHubError('too-large', 'File too large (> 50 MB)');
  }
  return text;
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err as { name?: string } | null)?.name === 'AbortError';
}

/** Readable reset time for the rate-limit message, e.g. "14:05". */
export function formatResetTime(resetAt: number): string {
  return new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toLoadError(err: unknown, file: string): LoadError {
  if (err instanceof GitHubRateLimited) {
    return {
      file,
      message:
        err.resetAt === null
          ? 'GitHub rate limit reached (60 requests per hour); try again later'
          : `GitHub rate limit reached (60 requests per hour); try again after ${formatResetTime(err.resetAt)}`,
      reason: 'rate-limited',
    };
  }
  if (err instanceof GitHubError) return { file, message: err.message, reason: err.reason };
  // Anything else (offline, CORS, DNS): a fixed message, never the error text of a response.
  return { file, message: 'Could not reach GitHub', reason: 'network' };
}

/**
 * The entry point (called through `runLoad`). Never rejects: every failure is a `LoadError`, and an
 * aborted load resolves with nothing (its commit is discarded by the store anyway).
 */
export async function loadGithubSource(
  ownerRepo: string,
  ref: string,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
  cachedRef?: { sha: string; date: string },
): Promise<{ sources: Source[]; errors: LoadError[] }> {
  const v = validateGithubInput(ownerRepo, ref);
  if (v === null) {
    return {
      sources: [],
      errors: [{ file: 'GitHub', message: INVALID_INPUT, reason: 'not-found' }],
    };
  }
  const { owner, repo } = v;
  const where = `${owner}/${repo}@${v.ref}`;
  try {
    const resolved =
      cachedRef && SHA_RE.test(cachedRef.sha) && Number.isFinite(Date.parse(cachedRef.date))
        ? cachedRef
        : await resolveRef(owner, repo, v.ref, signal);
    const { names, errors } = await listBenchmarks(owner, repo, resolved.sha, signal);
    onProgress?.(0, names.length);
    const files: SourceFile[] = [];
    const lastModified = Date.parse(resolved.date);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      try {
        const text = await fetchTable(owner, repo, resolved.sha, name, signal);
        files.push({ path: `benchmarks/${name}`, text, lastModified });
      } catch (err) {
        if (isAbort(err, signal)) return { sources: [], errors: [] };
        if (err instanceof GitHubRateLimited) throw err;
        errors.push(toLoadError(err, name));
      }
      onProgress?.(i + 1, names.length);
    }
    if (signal.aborted) return { sources: [], errors: [] };
    if (files.length === 0) {
      errors.push({ file: where, message: 'No CSV files under benchmarks/', reason: 'not-found' });
      return { sources: [], errors };
    }
    const built = buildSource(files, {
      label: `${repo}@${v.ref}`,
      origin: 'github',
      meta: { owner, repo, ref: v.ref, sha: resolved.sha, date: resolved.date },
    });
    return { sources: built.source ? [built.source] : [], errors: [...errors, ...built.errors] };
  } catch (err) {
    if (isAbort(err, signal)) return { sources: [], errors: [] };
    return { sources: [], errors: [toLoadError(err, where)] };
  }
}
