import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatResetTime,
  GITHUB_MAX_ATTEMPTS,
  GITHUB_RETRY_BUDGET_MS,
  loadGithubSource,
  validateGithubInput,
} from './github';

const SHA = 'a'.repeat(40);
const DATE = '2026-01-01T00:00:00Z';
const API = 'https://api.github.com/repos/thousandbrainsproject/tbp.monty';
const RAW = `https://raw.githubusercontent.com/thousandbrainsproject/tbp.monty/${SHA}/benchmarks`;
const TABLE = 'Experiment,Correct (%)\nexp_a,100.00\nexp_b,90.00\n';

type Routes = Record<string, () => Response>;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

const commitBody = (sha = SHA, date: unknown = DATE) => ({ sha, commit: { committer: { date } } });
const entry = (name: string, size = 100, extra: Record<string, unknown> = {}) => ({
  type: 'file',
  name,
  size,
  ...extra,
});

let fetchMock: ReturnType<typeof vi.fn>;

function stub(routes: Routes) {
  fetchMock = vi.fn(async (url: string) => {
    const route = routes[url];
    if (!route) return new Response('nope', { status: 404 });
    return route();
  });
  vi.stubGlobal('fetch', fetchMock);
}

function happy(entries: unknown[] = [entry('ycb_10objs.csv'), entry('ycb_77objs.csv')]): Routes {
  const routes: Routes = {
    [`${API}/commits/main`]: () => json(commitBody()),
    [`${API}/contents/benchmarks?ref=${SHA}`]: () => json(entries),
  };
  for (const e of entries) {
    const name = (e as { name: string }).name;
    routes[`${RAW}/${encodeURIComponent(name)}`] = () => new Response(TABLE);
  }
  return routes;
}

const calledUrls = () => fetchMock.mock.calls.map((c) => c[0] as string);
const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateGithubInput', () => {
  it('accepts normal input and trims', () => {
    expect(validateGithubInput(' thousandbrainsproject/tbp.monty ', ' main ')).toEqual({
      owner: 'thousandbrainsproject',
      repo: 'tbp.monty',
      ref: 'main',
    });
    expect(validateGithubInput('o/r', 'feature/x')?.ref).toBe('feature/x');
    expect(validateGithubInput('o/r', SHA)?.ref).toBe(SHA);
  });

  it.each([
    ['../..', 'main'],
    ['../r', 'main'],
    ['o/..', 'main'],
    ['o/.', 'main'],
    ['o', 'main'],
    ['o/r/x', 'main'],
    ['-o/r', 'main'],
    ['o/r', 'a/../b'],
    ['o/r', 'a//b'],
    ['o/r', 'x.lock'],
    ['o/r', 'main@{1}'],
    ['o/r', 'a b'],
    ['o/r', 'a/'],
    ['o/r', ''],
    ['o/r', '/main'],
  ])('rejects %s @ %s', (or, ref) => {
    expect(validateGithubInput(or, ref)).toBeNull();
  });
});

describe('loadGithubSource', () => {
  it('loads the benchmark tables with the fixed fetch options', async () => {
    stub(happy());
    const sig = signal();
    const progress: [number, number][] = [];
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', sig, {
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(r.errors).toEqual([]);
    expect(r.sources).toHaveLength(1);
    const s = r.sources[0];
    expect(s.label).toBe('tbp.monty@main');
    expect(s.origin).toBe('github');
    expect(s.kind).toBe('repo');
    expect(s.meta).toEqual({
      owner: 'thousandbrainsproject',
      repo: 'tbp.monty',
      ref: 'main',
      sha: SHA,
      date: DATE,
    });
    expect(s.date).toBe(Date.parse(DATE));
    expect(s.tables.map((t) => t.path)).toEqual([
      'benchmarks/ycb_10objs.csv',
      'benchmarks/ycb_77objs.csv',
    ]);
    expect(progress.at(-1)).toEqual([2, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'follow',
        signal: sig,
      });
      const api = (url as string).startsWith('https://api.github.com/');
      expect(init.headers).toEqual(api ? { Accept: 'application/vnd.github+json' } : {});
      // Only the branch → commit lookup revalidates; SHA-keyed URLs are immutable.
      const sha = (url as string).includes(SHA);
      expect(init.cache).toBe(sha ? 'force-cache' : 'no-cache');
    }
  });

  it('builds the ref path per segment', async () => {
    const routes = happy();
    routes[`${API}/commits/feature/x`] = routes[`${API}/commits/main`];
    stub(routes);
    await loadGithubSource('thousandbrainsproject/tbp.monty', 'feature/x', signal());
    expect(calledUrls()[0]).toBe(
      'https://api.github.com/repos/thousandbrainsproject/tbp.monty/commits/feature/x',
    );
  });

  it.each([
    ['..', 'main'],
    ['../..', 'main'],
    ['o/..', 'main'],
    ['o/r', 'a/../b'],
    ['o/r', 'a//b'],
    ['o/r', 'x.lock'],
    ['o/r', 'main@{1}'],
    ['o/r', 'a b'],
  ])('rejects %s @ %s before any request', async (or, ref) => {
    stub({});
    const r = await loadGithubSource(or, ref, signal());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r).toEqual({
      sources: [],
      errors: [{ file: 'GitHub', message: 'Invalid owner/repo or ref', reason: 'not-found' }],
    });
  });

  it('404 → not-found', async () => {
    stub({});
    const r = await loadGithubSource('o/r', 'main', signal());
    expect(r.sources).toEqual([]);
    expect(r.errors).toEqual([
      { file: 'o/r@main', message: 'repo/ref/benchmarks not found', reason: 'not-found' },
    ]);
  });

  describe('transient failures', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Fails `n` times with `make()`, then succeeds with `ok()`. */
    function flaky(n: number, make: () => Response, ok: () => Response): () => Response {
      let calls = 0;
      return () => (calls++ < n ? make() : ok());
    }
    const throttled =
      (headers: Record<string, string> = {}) =>
      () =>
        new Response('{"message":"too many requests"}', { status: 429, headers });
    const load = (opts = {}, sig = signal()) =>
      loadGithubSource('thousandbrainsproject/tbp.monty', 'main', sig, opts);

    async function settle<T>(p: Promise<T>, ms = 600_000): Promise<T> {
      await vi.advanceTimersByTimeAsync(ms);
      return p;
    }

    /** Asserts the next request is sent exactly `ms` after the last response. */
    async function expectNextRequestAfter(ms: number, calls: number) {
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(fetchMock).toHaveBeenCalledTimes(calls);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
    }

    it('a 429 on the first try is retried after 2 s and the load succeeds', async () => {
      const routes = happy();
      routes[`${API}/commits/main`] = flaky(1, throttled(), () => json(commitBody()));
      stub(routes);
      const p = load();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expectNextRequestAfter(2_000, 1);
      const r = await settle(p);
      expect(r.errors).toEqual([]);
      expect(r.sources).toHaveLength(1);
      expect(calledUrls().slice(0, 2)).toEqual([`${API}/commits/main`, `${API}/commits/main`]);
    });

    it('a 429 on a raw CSV (no retry-after exposed) is retried and that file still loads', async () => {
      const routes = happy();
      routes[`${RAW}/ycb_77objs.csv`] = flaky(1, throttled(), () => new Response(TABLE));
      stub(routes);
      const r = await settle(load());
      expect(r.errors).toEqual([]);
      expect(r.sources[0].tables).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it.each([500, 502, 503])('HTTP %i is retried', async (status) => {
      const routes = happy();
      routes[`${API}/contents/benchmarks?ref=${SHA}`] = flaky(
        1,
        () => new Response('<html>oops</html>', { status }),
        () => json([entry('ycb_10objs.csv')]),
      );
      stub(routes);
      const r = await settle(load());
      expect(r.errors).toEqual([]);
      expect(r.sources[0].tables).toHaveLength(1);
    });

    it('honours retry-after (seconds) when it is longer than the backoff', async () => {
      const routes = happy();
      routes[`${API}/commits/main`] = flaky(1, throttled({ 'retry-after': '5' }), () =>
        json(commitBody()),
      );
      stub(routes);
      const p = load();
      await vi.advanceTimersByTimeAsync(0);
      await expectNextRequestAfter(5_000, 1);
      const r = await settle(p);
      expect(r.errors).toEqual([]);
    });

    it('caps a single wait at 60 s even for a longer retry-after', async () => {
      const routes = happy();
      routes[`${API}/commits/main`] = flaky(1, throttled({ 'retry-after': '600' }), () =>
        json(commitBody()),
      );
      stub(routes);
      const p = load();
      await vi.advanceTimersByTimeAsync(0);
      await expectNextRequestAfter(60_000, 1);
      const r = await settle(p);
      expect(r.errors).toEqual([]);
    });

    it('a 429 that persists → throttle error after 5 attempts with backoff 2, 4, 8, 16 s', async () => {
      stub({ [`${API}/commits/main`]: throttled() });
      const p = load();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expectNextRequestAfter(2_000, 1);
      await expectNextRequestAfter(4_000, 2);
      await expectNextRequestAfter(8_000, 3);
      await expectNextRequestAfter(16_000, 4);
      const r = await settle(p);
      expect(fetchMock).toHaveBeenCalledTimes(GITHUB_MAX_ATTEMPTS);
      expect(r.sources).toEqual([]);
      expect(r.errors).toEqual([
        {
          file: 'thousandbrainsproject/tbp.monty@main',
          message:
            'api.github.com is throttling this network (a VPN or shared connection can cause this); try again later',
          reason: 'rate-limited',
        },
      ]);
      expect(r.errors[0].message).not.toContain('too many requests');
      expect(r.errors[0].message).not.toContain('HTTP 429');
    });

    it('a raw-host throttle names raw.githubusercontent.com', async () => {
      const routes = happy();
      routes[`${RAW}/ycb_10objs.csv`] = throttled();
      stub(routes);
      const r = await settle(load());
      expect(r.errors).toEqual([
        {
          file: 'thousandbrainsproject/tbp.monty@main',
          message:
            'raw.githubusercontent.com is throttling this network (a VPN or shared connection can cause this); try again later',
          reason: 'rate-limited',
        },
      ]);
    });

    it('the total wait per load is bounded by the budget', async () => {
      // The lookup waits 60 s (retry-after), leaving 30 s; the listing then asks for 60 s again,
      // which no longer fits, so the load gives up there instead of waiting on.
      const routes = happy();
      routes[`${API}/commits/main`] = flaky(1, throttled({ 'retry-after': '60' }), () =>
        json(commitBody()),
      );
      routes[`${API}/contents/benchmarks?ref=${SHA}`] = throttled({ 'retry-after': '60' });
      stub(routes);
      const waits: (number | null)[] = [];
      const r = await settle(load({ onWait: (w: number | null) => waits.push(w) }));
      expect(r.errors[0].reason).toBe('rate-limited');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(waits.filter((w) => w !== null)).toHaveLength(1);
      expect(60_000 + 60_000).toBeGreaterThan(GITHUB_RETRY_BUDGET_MS);
    });

    it('a throttled file stops the load (no further files are requested)', async () => {
      const routes = happy();
      routes[`${RAW}/ycb_10objs.csv`] = throttled();
      stub(routes);
      const r = await settle(load());
      expect(r.errors[0].reason).toBe('rate-limited');
      expect(fetchMock).toHaveBeenCalledTimes(2 + GITHUB_MAX_ATTEMPTS);
      expect(calledUrls().some((u) => u.endsWith('/ycb_77objs.csv'))).toBe(false);
    });

    it('reports each wait to onWait (end time, then null)', async () => {
      const routes = happy();
      routes[`${API}/commits/main`] = flaky(1, throttled(), () => json(commitBody()));
      stub(routes);
      const start = Date.parse('2026-01-01T12:00:00Z');
      vi.setSystemTime(start);
      const waits: (number | null)[] = [];
      const r = await settle(load({ onWait: (w: number | null) => waits.push(w) }));
      expect(r.errors).toEqual([]);
      expect(waits).toEqual([start + 2_000, null]);
    });

    it('an exhausted 429 with retry-after reports that time, not the hourly quota', async () => {
      const start = Date.parse('2026-01-01T12:00:00Z');
      vi.setSystemTime(start);
      stub({ [`${API}/commits/main`]: throttled({ 'retry-after': '30' }) });
      const r = await settle(load());
      expect(r.errors[0].reason).toBe('rate-limited');
      // Four waits of 30 s (retry-after beats the backoff) = 120 s > budget? No: the budget is
      // checked per wait, 30+30+30 = 90 s fits, the fourth does not → 4 attempts, 3 waits.
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(r.errors[0].message).toBe(
        `api.github.com is throttling this network (a VPN or shared connection can cause this); try again after ${formatResetTime(start + 90_000 + 30_000)}`,
      );
      expect(r.errors[0].message).not.toContain('60 requests');
    });

    it('a 403 with retry-after (secondary limit) is retried; a plain 403 is not', async () => {
      const routes = happy();
      routes[`${API}/commits/main`] = flaky(
        1,
        () => new Response('', { status: 403, headers: { 'retry-after': '1' } }),
        () => json(commitBody()),
      );
      stub(routes);
      const r = await settle(load());
      expect(r.errors).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(5);

      stub({ [`${API}/commits/main`]: () => new Response('', { status: 403 }) });
      const r2 = await settle(load());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(r2.errors[0]).toMatchObject({
        reason: 'network',
        message: 'GitHub request failed (HTTP 403)',
      });
    });

    it('the hourly quota (x-ratelimit-remaining: 0) is never retried', async () => {
      stub({
        [`${API}/commits/main`]: throttled({ 'x-ratelimit-remaining': '0', 'retry-after': '1' }),
      });
      const r = await settle(load());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(r.errors[0].reason).toBe('rate-limited');
      expect(r.errors[0].message).toContain('60 requests per hour');
    });

    it('404 and 4xx other than 403/429 are not retried', async () => {
      stub({ [`${API}/commits/main`]: () => new Response('', { status: 422 }) });
      const r = await settle(load());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(r.errors[0].message).toBe('GitHub request failed (HTTP 422)');
    });

    it('aborting during the retry wait resolves with nothing, ends the wait, sends no more requests', async () => {
      const ctrl = new AbortController();
      stub({ [`${API}/commits/main`]: throttled() });
      const waits: (number | null)[] = [];
      const p = load({ onWait: (w: number | null) => waits.push(w) }, ctrl.signal);
      await vi.advanceTimersByTimeAsync(500);
      ctrl.abort();
      const r = await settle(p);
      expect(r).toEqual({ sources: [], errors: [] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(waits).toHaveLength(2);
      expect(waits[1]).toBeNull();
    });
  });

  describe('resolved-ref cache', () => {
    it('onResolved fires with the sha/date before any file request', async () => {
      stub(happy());
      const seen: unknown[] = [];
      let callsAtResolve = -1;
      await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal(), {
        onResolved: (r) => {
          seen.push(r);
          callsAtResolve = fetchMock.mock.calls.length;
        },
      });
      expect(seen).toEqual([{ sha: SHA, date: DATE }]);
      expect(callsAtResolve).toBe(1);
    });

    it('onResolved fires even when a later request fails', async () => {
      const routes = happy();
      routes[`${API}/contents/benchmarks?ref=${SHA}`] = () => new Response('', { status: 422 });
      stub(routes);
      const seen: unknown[] = [];
      const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal(), {
        onResolved: (x) => seen.push(x),
      });
      expect(r.sources).toEqual([]);
      expect(seen).toEqual([{ sha: SHA, date: DATE }]);
    });

    it('a cached ref skips the lookup and does not fire onResolved', async () => {
      stub(happy());
      const seen: unknown[] = [];
      const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal(), {
        cachedRef: { sha: SHA, date: DATE },
        onResolved: (x) => seen.push(x),
      });
      expect(r.errors).toEqual([]);
      expect(seen).toEqual([]);
      expect(calledUrls()[0]).toBe(`${API}/contents/benchmarks?ref=${SHA}`);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  it('403 rate-limited carries the reset time', async () => {
    const reset = 1_900_000_000;
    stub({
      [`${API}/commits/main`]: () =>
        new Response('{"message":"API rate limit exceeded"}', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
        }),
    });
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal());
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].reason).toBe('rate-limited');
    expect(r.errors[0].message).toContain(formatResetTime(reset * 1000));
    expect(r.errors[0].message).not.toContain('API rate limit exceeded');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['non-hex sha', commitBody('g'.repeat(40))],
    ['39-char sha', commitBody('a'.repeat(39))],
    ['unparsable date', commitBody(SHA, 'yesterday')],
    ['missing commit', { sha: SHA }],
  ])('a commits response with %s → network, no further request', async (_, body) => {
    stub({ [`${API}/commits/main`]: () => json(body) });
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal());
    expect(r.errors).toEqual([
      {
        file: 'thousandbrainsproject/tbp.monty@main',
        message: 'unexpected GitHub response',
        reason: 'network',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a contents response that is not an array → network', async () => {
    const routes = happy();
    routes[`${API}/contents/benchmarks?ref=${SHA}`] = () => json({ message: 'x' });
    stub(routes);
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal());
    expect(r.errors[0]).toMatchObject({ reason: 'network', message: 'unexpected GitHub response' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores odd names and never uses download_url', async () => {
    const entries = [
      entry('ycb_10objs.csv', 100, { download_url: 'https://evil.example/x.csv' }),
      entry('../x.csv'),
      entry('a/b.csv'),
      { type: 'dir', name: 'sub.csv', size: 0 },
      entry('readme.md'),
    ];
    const routes = happy([entries[0]]);
    routes[`${API}/contents/benchmarks?ref=${SHA}`] = () => json(entries);
    stub(routes);
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal());
    expect(r.errors).toEqual([]);
    expect(r.sources[0].tables).toHaveLength(1);
    const urls = calledUrls();
    expect(urls).toContain(`${RAW}/ycb_10objs.csv`);
    expect(urls.some((u) => u.includes('evil.example'))).toBe(false);
    expect(urls.some((u) => u.includes('x.csv') || u.includes('b.csv'))).toBe(false);
  });

  it('a 60 MB entry is skipped, the others load', async () => {
    const entries = [entry('big.csv', 60 * 1024 * 1024), entry('ycb_10objs.csv')];
    const routes = happy([entries[1]]);
    routes[`${API}/contents/benchmarks?ref=${SHA}`] = () => json(entries);
    stub(routes);
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal());
    expect(r.errors).toEqual([
      { file: 'big.csv', message: 'File too large (> 50 MB)', reason: 'too-large' },
    ]);
    expect(r.sources[0].tables).toHaveLength(1);
    expect(calledUrls().some((u) => u.endsWith('/big.csv'))).toBe(false);
  });

  it('51 entries → too-many and no raw request', async () => {
    const entries = Array.from({ length: 51 }, (_, i) => entry(`t${i}.csv`));
    stub(happy(entries));
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal());
    expect(r.sources).toEqual([]);
    expect(r.errors).toEqual([
      {
        file: 'thousandbrainsproject/tbp.monty@main',
        message: 'Too many CSV files (> 50)',
        reason: 'too-many',
      },
    ]);
    expect(calledUrls().some((u) => u.startsWith('https://raw.githubusercontent.com/'))).toBe(
      false,
    );
  });

  it('entries over 200 MB in total → too-large and no raw request', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => entry(`t${i}.csv`, 45 * 1024 * 1024));
    stub(happy(entries));
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal());
    expect(r.errors).toEqual([
      {
        file: 'thousandbrainsproject/tbp.monty@main',
        message: 'Files too large in total (> 200 MB)',
        reason: 'too-large',
      },
    ]);
    expect(calledUrls().some((u) => u.startsWith('https://raw.githubusercontent.com/'))).toBe(
      false,
    );
  });

  it('a raw content-length over 50 MB skips that file', async () => {
    const routes = happy();
    routes[`${RAW}/ycb_77objs.csv`] = () =>
      new Response(TABLE, { headers: { 'content-length': String(51 * 1024 * 1024) } });
    stub(routes);
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal());
    expect(r.errors).toEqual([
      { file: 'ycb_77objs.csv', message: 'File too large (> 50 MB)', reason: 'too-large' },
    ]);
    expect(r.sources[0].tables).toHaveLength(1);
  });

  it('a response redirected to another origin → network', async () => {
    stub({
      [`${API}/commits/main`]: () => {
        const res = json(commitBody());
        Object.defineProperty(res, 'url', { value: 'https://evil.example/commits/main' });
        return res;
      },
    });
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal());
    expect(r.errors[0]).toMatchObject({ reason: 'network', message: 'unexpected GitHub response' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a 500 body is never shown', async () => {
    vi.useFakeTimers();
    stub({
      [`${API}/commits/main`]: () => new Response('<script>alert(1)</script>', { status: 500 }),
    });
    const p = loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal());
    await vi.advanceTimersByTimeAsync(60_000); // through the retries
    const r = await p;
    vi.useRealTimers();
    expect(fetchMock).toHaveBeenCalledTimes(GITHUB_MAX_ATTEMPTS);
    expect(r.errors[0].reason).toBe('network');
    expect(r.errors[0].message).toBe('GitHub request failed (HTTP 500)');
    expect(r.errors[0].message).not.toContain('<script>');
    expect(r.errors[0].message).not.toContain('alert');
  });

  it('a cached ref skips the commits request', async () => {
    stub(happy());
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal(), {
      cachedRef: { sha: SHA, date: DATE },
    });
    expect(r.sources).toHaveLength(1);
    expect(calledUrls().some((u) => u.includes('/commits/'))).toBe(false);
  });

  it('an invalid cached sha falls back to resolveRef', async () => {
    stub(happy());
    await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', signal(), {
      cachedRef: { sha: 'nope', date: DATE },
    });
    expect(calledUrls()[0]).toBe(`${API}/commits/main`);
  });

  it('an aborted load resolves with nothing', async () => {
    const ctl = new AbortController();
    fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      ctl.abort();
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return json(commitBody());
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await loadGithubSource('thousandbrainsproject/tbp.monty', 'main', ctl.signal);
    expect(r).toEqual({ sources: [], errors: [] });
  });

  it('a fetch that throws (offline) → network with a fixed message', async () => {
    fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch: secret detail');
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await loadGithubSource('o/r', 'main', signal());
    expect(r.errors).toEqual([
      { file: 'o/r@main', message: 'Could not reach GitHub', reason: 'network' },
    ]);
  });
});
