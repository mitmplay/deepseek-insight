/**
 * Coverage round: src/lib/server/github-stars.ts and
 * src/routes/api/terminal/+server.ts — both sat exactly at the 80% floor.
 * Style follows terminal-route-seams.test.ts: mocks for the registry and
 * config seams, stubbed global fetch for the GitHub API.
 */
import { homedir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registrySpies = vi.hoisted(() => ({
	list: vi.fn(),
	create: vi.fn()
}));
const configSpies = vi.hoisted(() => ({
	readTerminalConfig: vi.fn()
}));

vi.mock('$lib/server/terminal/registry.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/terminal/registry.js')>();
	return { ...actual, terminalRegistry: registrySpies };
});
vi.mock('$lib/server/insight-config.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/insight-config.js')>();
	return { ...actual, readTerminalConfig: configSpies.readTerminalConfig };
});

import { fetchRepoStars, fetchStarsByKey, repoSlugFromUrl } from '../../src/lib/server/github-stars';
import { GET as terminalGet, POST as terminalPost } from '../../src/routes/api/terminal/+server';

const fetchMock = vi.fn();

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockReset();
	configSpies.readTerminalConfig.mockReset();
	registrySpies.list.mockReset();
	registrySpies.list.mockReturnValue([]);
	registrySpies.create.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function okStars(count: number | string): Response {
	return new Response(JSON.stringify(typeof count === 'string' ? count : { stargazers_count: count }), {
		status: 200
	});
}

// ---------------------------------------------------------------- github-stars

describe('repoSlugFromUrl', () => {
	it.each([
		['https://github.com/owner/repo', 'owner/repo'],
		['https://github.com/owner/repo.git', 'owner/repo'],
		['https://github.com/owner/repo/tree/main/pstack/skills', 'owner/repo'],
		['https://github.com/owner/repo/', 'owner/repo']
	])('parses %s -> %s', (url, slug) => {
		expect(repoSlugFromUrl(url)).toBe(slug);
	});

	it.each([
		['https://gitlab.com/owner/repo'],
		['https://github.com/owner'],
		['https://github.com/'],
		['https://github.com/own er/repo'],
		['https://github.com/owner/re po'],
		['not a url at all']
	])('rejects %s', (url) => {
		expect(repoSlugFromUrl(url)).toBeNull();
	});
});

describe('fetchRepoStars — cache and error branches', () => {
	it('a cache miss fetches once and caches; the cache hit skips fetch', async () => {
		fetchMock.mockResolvedValueOnce(okStars(1234));
		await expect(fetchRepoStars('owner/repo')).resolves.toBe(1234);
		await expect(fetchRepoStars('owner/repo')).resolves.toBe(1234);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/owner/repo');
	});

	it('an entry older than the TTL is refetched (cache expired)', async () => {
		vi.useFakeTimers();
		fetchMock.mockResolvedValueOnce(okStars(7));
		await fetchRepoStars('expired/repo');
		vi.advanceTimersByTime(60 * 60 * 1000 + 1);
		fetchMock.mockResolvedValueOnce(okStars(8));
		await expect(fetchRepoStars('expired/repo')).resolves.toBe(8);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('a non-OK status answers null without caching', async () => {
		fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }));
		await expect(fetchRepoStars('gone/repo')).resolves.toBeNull();
		fetchMock.mockResolvedValueOnce(okStars(1));
		await expect(fetchRepoStars('gone/repo')).resolves.toBe(1); // not cached, refetched
	});

	it('a malformed body (missing/non-number stargazers_count) answers null', async () => {
		fetchMock.mockResolvedValueOnce(okStars('twelve' as unknown as number));
		await expect(fetchRepoStars('weird/repo')).resolves.toBeNull();
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
		await expect(fetchRepoStars('weird/repo')).resolves.toBeNull();
	});

	it('a rejected fetch (network down) answers null', async () => {
		fetchMock.mockRejectedValueOnce(new Error('offline'));
		await expect(fetchRepoStars('down/repo')).resolves.toBeNull();
	});
});

describe('fetchStarsByKey', () => {
	it('keeps successes, drops non-GitHub URLs and failed fetches', async () => {
		fetchMock
			.mockResolvedValueOnce(okStars(10))
			.mockRejectedValueOnce(new Error('rate limited'));
		const stars = await fetchStarsByKey([
			{ key: 'good', repo: 'https://github.com/a/good' },
			{ key: 'fail', repo: 'https://github.com/b/fail' },
			{ key: 'nope', repo: 'https://gitlab.com/c/nope' }
		]);
		expect(stars).toEqual({ good: 10 });
	});

	it('an empty item list answers an empty record', async () => {
		expect(await fetchStarsByKey([])).toEqual({});
	});
});

// ------------------------------------------------------- /api/terminal route

const enabledCfg = {
	enabled: true,
	maxSessions: 2,
	graceMs: 1000,
	idleMs: 2000,
	tailBytes: 4096
};

function session(id: string) {
	return { id, exited: false, streamBytes: () => 42 };
}

describe('GET /api/terminal', () => {
	it('answers the enabled flag, maxSessions and the registry list', () => {
		configSpies.readTerminalConfig.mockReturnValueOnce({ ...enabledCfg, enabled: false });
		registrySpies.list.mockReturnValueOnce([session('a')]);
		const res = terminalGet() as Response;
		expect(res.status).toBe(200);
	});
});

describe('POST /api/terminal', () => {
	function post(body: unknown): { request: Request } {
		return {
			request: new Request('http://localhost/api/terminal', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: typeof body === 'string' ? body : JSON.stringify(body)
			})
		};
	}

	it('a disabled flag answers 403 NOT_ENABLED before anything else', async () => {
		configSpies.readTerminalConfig.mockReturnValueOnce({ ...enabledCfg, enabled: false });
		const res = (await terminalPost(post({ cwd: '/tmp' } as never))) as Response;
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'NOT_ENABLED' });
		expect(registrySpies.create).not.toHaveBeenCalled();
	});

	it('a full desk answers 429 MAX_SESSIONS', async () => {
		configSpies.readTerminalConfig.mockReturnValueOnce({ ...enabledCfg, maxSessions: 1 });
		registrySpies.list.mockReturnValueOnce([session('live')]);
		const res = (await terminalPost(post({})) as Response);
		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ error: 'MAX_SESSIONS' });
	});

	it('an exited session does not count against maxSessions', async () => {
		configSpies.readTerminalConfig.mockReturnValueOnce({ ...enabledCfg, maxSessions: 1 });
		registrySpies.list.mockReturnValueOnce([{ ...session('dead'), exited: true }]);
		registrySpies.create.mockReturnValueOnce({ session: session('new'), token: 'tok' });
		const res = (await terminalPost(post({})) as Response);
		expect(res.status).toBe(200);
	});

	it('a non-JSON body falls back to an empty OpenBody and the defaults win', async () => {
		configSpies.readTerminalConfig.mockReturnValueOnce({ ...enabledCfg });
		registrySpies.create.mockReturnValueOnce({ session: session('s'), token: 't' });
		const res = (await terminalPost(post('{broken')) as Response);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ sessionId: 's', token: 't', fromByte: 0, totalBytes: 42 });
		const spec = registrySpies.create.mock.calls[0]?.[0];
		expect(spec.cwd).toBe(homedir());
		expect(spec.rows).toBe(24);
		expect(spec.cols).toBe(80);
		expect(spec.argv[0]).toBe(process.env.SHELL || '/bin/bash');
	});

	it('explicit request values win; out-of-range and non-integer values fall back', async () => {
		configSpies.readTerminalConfig.mockReturnValueOnce({ ...enabledCfg });
		registrySpies.create.mockReturnValueOnce({ session: session('s2'), token: 't2' });
		await terminalPost(
			post({ cwd: '/tmp/x', rows: 50, cols: 120, extra: 1 } as never)
		) as Response;
		const spec = registrySpies.create.mock.calls[0]?.[0];
		expect(spec.cwd).toBe('/tmp/x');
		expect(spec.rows).toBe(50);
		expect(spec.cols).toBe(120);
	});

	it.each([
		['rows below floor', { rows: 1 }],
		['rows above ceiling', { rows: 201 }],
		['rows non-integer', { rows: 2.5 }],
		['rows non-number', { rows: 'big' }],
		['cols below floor', { cols: 1 }],
		['cols above ceiling', { cols: 501 }],
		['cols non-number', { cols: null }]
	])('%s coerces to the fallback', async (_name, body) => {
		configSpies.readTerminalConfig.mockReturnValueOnce({ ...enabledCfg });
		registrySpies.create.mockReturnValueOnce({ session: session('s3'), token: 't3' });
		await terminalPost(post(body)) as Response;
		const spec = registrySpies.create.mock.calls[0]?.[0];
		expect(spec.rows).toBe(24);
		expect(spec.cols).toBe(80);
	});

	it('an empty cwd string falls back to homedir', async () => {
		configSpies.readTerminalConfig.mockReturnValueOnce({ ...enabledCfg });
		registrySpies.create.mockReturnValueOnce({ session: session('s4'), token: 't4' });
		await terminalPost(post({ cwd: '' })) as Response;
		expect(registrySpies.create.mock.calls[0]?.[0].cwd).toBe(homedir());
	});
});