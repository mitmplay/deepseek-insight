/**
 * executor/workspace edge tests — the branches the /workspace + /permission
 * route-stub suites don't reach: the wire-failure arms of runPermissionLine,
 * runWorkspaceLine's tilde/refusal/rename chains, and resolveWorkspaceToken's
 * full match ladder. Direct calls + stubbed fetch (the house pattern).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	runPermissionLine,
	runWorkspaceLine,
	resolveWorkspaceToken
} from '$lib/services/chat/executor/workspace';
import type { ExecutorContext } from '$lib/services/chat/command-executor';

const SELF = 'session-11111111-0000-4000-8000-000000000001';
function ctx(over: Partial<ExecutorContext> = {}): ExecutorContext {
	return { sessionId: SELF, workspace: null, agent: null, panelId: 'p1', ...over };
}
function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** Stub fetch with ordered matchers; returns the recorded calls. */
function stubFetch(routes: Array<{ test: (url: string, init?: RequestInit) => boolean; respond: (url: string, init?: RequestInit) => Response }>) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
			calls.push({ url, init });
			for (const r of routes) if (r.test(url, init)) return r.respond(url, init);
			return jsonRes({ ok: false }, 404);
		})
	);
	return calls;
}

describe('runPermissionLine', () => {
	it('ok reply carries the host text; ok without text uses the fixed copy (GAP-4)', async () => {
		const notes: Array<[boolean, string]> = [];
		stubFetch([{ test: (u) => u.includes('/permission'), respond: () => jsonRes({ ok: true, text: 'preset is default' }) }]);
		const r1 = await runPermissionLine('/permission', ctx(), (ok, n) => notes.push([ok, n]));
		expect(r1).toEqual({ ok: true, note: 'preset is default' });
		stubFetch([{ test: (u) => u.includes('/permission'), respond: () => jsonRes({ ok: true }) }]);
		const r2 = await runPermissionLine('/permission acceptEdits', ctx(), (ok, n) => notes.push([ok, n]));
		expect(r2).toEqual({ ok: true, note: 'permission updated' });
		expect(notes).toEqual([[true, 'preset is default'], [true, 'permission updated']]);
	});

	it('an error body surfaces error.message; an unparseable body falls back to the HTTP status', async () => {
		const notes: Array<[boolean, string]> = [];
		stubFetch([{ test: (u) => u.includes('/permission'), respond: () => jsonRes({ ok: false, error: { message: 'unknown preset' } }) }]);
		const r1 = await runPermissionLine('/permission nope', ctx(), (ok, n) => notes.push([ok, n]));
		expect(r1).toEqual({ ok: false, note: 'unknown preset' });
		vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 500 })));
		const r2 = await runPermissionLine('/permission nope', ctx(), (ok, n) => notes.push([ok, n]));
		expect(r2).toEqual({ ok: false, note: 'permission switch failed (HTTP 500)' });
	});

	it('a network failure is an honest note with the error message', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
		const r = await runPermissionLine('/permission', ctx());
		expect(r).toEqual({ ok: false, note: 'permission switch failed (ECONNREFUSED)' });
	});
});

describe('runWorkspaceLine', () => {
	it('usage guards: no path, then a relative path, both before any RPC', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const r1 = await runWorkspaceLine(undefined, undefined, ctx());
		expect(r1.ok).toBe(false);
		expect(r1.note).toBe('usage: /workspace <full-path> [name]');
		const r2 = await runWorkspaceLine('relative/path', undefined, ctx());
		expect(r2.ok).toBe(false);
		expect(r2.note).toContain('pass an absolute or ~ path');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('a tilde path expands against the host home before the wire (D3)', async () => {
		const calls = stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/directory'), respond: () => jsonRes({ ok: true, listing: { home: '/Users/op' } }) },
			{ test: (u) => u.endsWith('/api/dsh/workspaces'), respond: (u, init) => jsonRes({ ok: true, created: true, workspace: { workspaceId: 'ws-9', title: 'ws' } }) }
		]);
		const r = await runWorkspaceLine('~/projects/x', undefined, ctx());
		expect(r.ok).toBe(true);
		const post = calls.find((c) => c.url.endsWith('/api/dsh/workspaces'))!;
		expect(JSON.parse(String(post.init!.body))).toEqual({ path: '/Users/op/projects/x' });
	});

	it('a failed home read surfaces the host message plus the absolute-path remedy', async () => {
		const notes: Array<[boolean, string]> = [];
		stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/directory'), respond: () => jsonRes({ ok: false, error: { message: 'native only' } }, 403) }
		]);
		const r = await runWorkspaceLine('~/x', undefined, ctx(), (ok, n) => notes.push([ok, n]));
		expect(r.ok).toBe(false);
		expect(r.note).toContain('could not read the host home (native only)');
		expect(notes.length).toBe(1);
	});

	it('a home fetch rejection skips expansion without crashing', async () => {
		vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).endsWith('/api/dsh/directory')) throw new Error('no route');
			return jsonRes({ ok: false }, 500);
		}));
		const r = await runWorkspaceLine('~/x', undefined, ctx());
		expect(r.ok).toBe(false);
		expect(r.note).toContain('could not read the host home (no route)');
	});

	it('the host refusal rides the note with the mkdir remedy (D4)', async () => {
		stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/workspaces'), respond: () => jsonRes({ ok: false, error: { message: 'no such folder' } }, 400) }
		]);
		const r = await runWorkspaceLine('/tmp/missing', undefined, ctx());
		expect(r.ok).toBe(false);
		expect(r.note).toContain('/workspace refused: no such folder');
		expect(r.note).toContain('mkdir /tmp/missing');
	});

	it('an already-adopted path keeps its title and skips the rename (D2)', async () => {
		const calls = stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/workspaces'), respond: () => jsonRes({ ok: true, created: false, workspace: { workspaceId: 'ws-1', title: 'Existing' } }) }
		]);
		const r = await runWorkspaceLine('/tmp/x', 'Renamed', ctx());
		expect(r.ok).toBe(true);
		expect(r.note).toContain('already adopted as "Existing"');
		expect(r.note).toContain('the name is NOT applied');
		expect(calls.some((c) => c.url.includes('/rename'))).toBe(false);
	});

	it('a rename failure keeps the adoption but says so honestly', async () => {
		const notes: Array<[boolean, string]> = [];
		stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/workspaces'), respond: () => jsonRes({ ok: true, created: true, workspace: { workspaceId: 'ws-2', title: 'x' } }) },
			{ test: (u) => u.includes('/rename'), respond: () => jsonRes({ ok: false, error: { message: 'title taken' } }, 409) }
		]);
		const r = await runWorkspaceLine('/tmp/x', 'MyWS', ctx(), (ok, n) => notes.push([ok, n]));
		expect(r.ok).toBe(true);
		expect(r.note).toContain('the rename to "MyWS" failed — title taken');
	});

	it('a workspaces POST network failure is an honest note', async () => {
		vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).endsWith('/api/dsh/directory')) return jsonRes({ ok: true, listing: { home: '/h' } });
			throw new Error('boom');
		}));
		const r = await runWorkspaceLine('~/x', undefined, ctx());
		expect(r.ok).toBe(false);
		expect(r.note).toBe('/workspace failed (boom)');
	});
});

describe('resolveWorkspaceToken', () => {
	it('a unique title wins; several titles refuse with the candidate list', async () => {
		const rows = [
			{ title: 'alpha', path: '/w/alpha' },
			{ title: 'dup', path: '/w/dup-1' },
			{ title: 'dup', path: '/w/dup-2' }
		];
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes({ ok: true, workspaces: rows }) }]);
		expect(await resolveWorkspaceToken('alpha')).toEqual({ path: '/w/alpha' });
		const amb = await resolveWorkspaceToken('dup');
		expect(amb.note).toContain('matches several workspaces');
		expect(amb.note).toContain('/w/dup-1 ("dup"), /w/dup-2 ("dup")');
	});

	it('an exact canonical path matches after titles miss', async () => {
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes({ ok: true, workspaces: [{ title: 'alpha', path: '/w/alpha' }] }) }]);
		expect(await resolveWorkspaceToken('/w/alpha')).toEqual({ path: '/w/alpha' });
	});

	it('an empty registry and a clean miss carry their own pointers', async () => {
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes({ ok: true, workspaces: [] }) }]);
		const empty = await resolveWorkspaceToken('nope');
		expect(empty.note).toContain('the registry is empty');
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes({ ok: true, workspaces: [{ title: 'alpha', path: '/w/alpha' }] }) }]);
		const miss = await resolveWorkspaceToken('nope');
		expect(miss.note).toContain('the registry holds: alpha');
	});

	it('a bad reply and a network failure are honest "unavailable" notes', async () => {
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes({ ok: false }, 503) }]);
		expect((await resolveWorkspaceToken('x')).note).toContain('unavailable (HTTP 503)');
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
		expect((await resolveWorkspaceToken('x')).note).toContain('unavailable — try again');
	});

	it('rows with non-string title/path are filtered out of the ladder', async () => {
		stubFetch([{ test: (u) => u.endsWith('/api/dsh/sessions'), respond: () => jsonRes({ ok: true, workspaces: [{ title: 7, path: '/w/x' }, { title: 'ok', path: 9 }] }) }]);
		const r = await resolveWorkspaceToken('whatever');
		expect(r.note).toContain('the registry is empty'); // every row filtered
	});
});
describe('runWorkspaceLine — degraded-wire arms', () => {
	it('a non-JSON directory reply falls back to the HTTP status in the tilde note', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })));
		const r = await runWorkspaceLine('~/x', undefined, ctx());
		expect(r.note).toContain('could not read the host home (HTTP 502)');
	});

	it('a non-JSON create reply falls back to the HTTP status in the refusal note', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
		const r = await runWorkspaceLine('/tmp/x', undefined, ctx());
		expect(r.note).toContain('/workspace refused: HTTP 500');
	});

	it('a non-JSON rename reply falls back to the HTTP status in the rename note', async () => {
		stubFetch([
			{ test: (u) => u.endsWith('/api/dsh/workspaces'), respond: () => jsonRes({ ok: true, created: true, workspace: { workspaceId: 'ws-3', title: 'x' } }) },
			{ test: (u) => u.includes('/rename'), respond: () => new Response('nope', { status: 418 }) }
		]);
		const r = await runWorkspaceLine('/tmp/x', 'MyWS', ctx());
		expect(r.ok).toBe(true);
		expect(r.note).toContain('rename to "MyWS" failed — HTTP 418');
	});

	it('a workspace row missing workspaceId/title still notes the adoption', async () => {
		const r = await runWorkspaceLine('/tmp/x', undefined, ctx(), undefined);
		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: true, created: false, workspace: {} })));
		const r2 = await runWorkspaceLine('/tmp/x', undefined, ctx());
		expect(r2.note).toContain('already adopted as ""');
	});

	it('an already-adopted path WITHOUT a name skips the rename caveat sentence', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: true, created: false, workspace: { workspaceId: 'ws-1', title: 'Existing' } })));
		const r = await runWorkspaceLine('/tmp/x', undefined, ctx());
		expect(r.note).not.toContain('the name is NOT applied');
	});

	it('a non-Error rejection stringifies via String(err) in both catches', async () => {
		vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).endsWith('/api/dsh/directory')) throw 'string-boom';
			throw 42;
		}));
		const r1 = await runWorkspaceLine('~/x', undefined, ctx());
		expect(r1.note).toContain('could not read the host home (string-boom)');
		const r2 = await runWorkspaceLine('/tmp/x', undefined, ctx());
		expect(r2.note).toBe('/workspace failed (42)');
	});
});

describe('resolveWorkspaceToken — degraded wire', () => {
	it('a non-Error permission rejection stringifies via String(err)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw 'gateway-flake'; }));
		const r = await runPermissionLine('/permission', ctx());
		expect(r.note).toBe('permission switch failed (gateway-flake)');
	});

	it('a non-JSON registry reply notes the HTTP status', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 504 })));
		expect((await resolveWorkspaceToken('x')).note).toContain('unavailable (HTTP 504)');
	});
});