/**
 * command-workspace-executor tests (2026-09-15, The Workspace Command ADR
 * D1–D5, Tasks 2.1-T / 2.2-T) — runWorkspaceLine (the /workspace handler:
 * D3 tilde expansion, D4 honest refusal, D2 conditional rename, F9 event)
 * and the /new ws-resolution branch (D5 title→path match, candidates
 * note, F11 fresh-install note, cwd displacement). Stubbed fetch — the
 * house pattern; the module talks to DSI api routes only (BC-2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type ExecutorContext } from '$lib/services/chat/command-executor';
import { parseCommand } from '$lib/services/chat/command-parser';
import { registerAddPanel, registerReplacePanel } from '$lib/services/panels/panel-registry';

const SELF = 'session-11111111-0000-4000-8000-000000000001';
const NEW_ID = 'session-22222222-0000-4000-8000-000000000002';

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => {
	registerAddPanel(null);
	registerReplacePanel(null);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** Route-stub harness: matchers in order, records every call. */
function stubFetch(
	routes: Array<{ test: (url: string, init?: RequestInit) => boolean; respond: () => Response }>
) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			calls.push({ url, init });
			for (const r of routes) {
				if (r.test(url, init)) return r.respond();
			}
			return jsonRes({ ok: false }, 404);
		})
	);
	return { calls };
}

function ctx(over: Partial<ExecutorContext> = {}): ExecutorContext {
	return { sessionId: SELF, workspace: '/w/proj', agent: 'main', panelId: 'p1', ...over };
}

const SESSIONS_POST = {
	test: (url: string, init?: RequestInit) =>
		url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
	respond: () => jsonRes({ ok: true, sessionId: NEW_ID })
};

// ── 2.1-T — runWorkspaceLine (/workspace) ───────────────────────────────

describe('executeCommand — /workspace (runWorkspaceLine, ADR D1–D4)', () => {
	it('happy path: create → rename (created=true + name) → event fired → note with the /new follow-up', async () => {
		const { calls } = stubFetch([
			{
				test: (url) => url.endsWith('/api/dsh/directory'),
				respond: () =>
					jsonRes({ ok: true, listing: { home: '/home/u', crumbs: [], entries: [], truncated: false } })
			},
			{
				test: (url) => url.endsWith('/api/dsh/workspaces') && !url.includes('/rename'),
				respond: () =>
					jsonRes({
						ok: true,
						created: true,
						workspace: { workspaceId: 'ws-1', title: 'workspace-ai', path: '/home/u/workspace-ai' }
					})
			},
			{
				test: (url, init) => url.endsWith('/api/dsh/workspaces/ws-1/rename') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, workspace: { workspaceId: 'ws-1', title: 'My WS' } })
			}
		]);
		const events: string[] = [];
		const spy = vi.spyOn(window, 'dispatchEvent').mockImplementation((e) => {
			events.push(e.type);
			return true;
		});

		// a SPACE-containing name splits into 3+ tokens → raw args (the
		// documented v1 give-up) — a single-token name is the happy shape
		const result = await executeCommand(parseCommand('/workspace ~/workspace-ai MyWS')!, ctx());

		expect(result.ok).toBe(true);
		expect(result.note).toContain('adopted /home/u/workspace-ai');
		expect(result.note).toContain('"MyWS"');
		expect(result.note).toContain('/new MyWS');
		expect(events).toContain('dsi:workspaces-changed');
		expect(spy).toHaveBeenCalled();
		const rename = calls.find((c) => c.url.endsWith('/ws-1/rename'));
		expect(rename).toBeDefined();
		expect(JSON.parse(String(rename!.init!.body))).toEqual({ title: 'MyWS' });
	});

	it('tilde expands against the host home in the create body (D3, listing.home)', async () => {
		const { calls } = stubFetch([
			{
				test: (url) => url.endsWith('/api/dsh/directory'),
				respond: () =>
					jsonRes({ ok: true, listing: { home: '/Users/op', crumbs: [], entries: [], truncated: false } })
			},
			{
				test: (url) => url.endsWith('/api/dsh/workspaces'),
				respond: () =>
					jsonRes({
						ok: true,
						created: true,
						workspace: { workspaceId: 'ws-2', title: 'x', path: '/Users/op/x' }
					})
			}
		]);

		await executeCommand(parseCommand('/workspace ~/x')!, ctx());

		const create = calls.find((c) => c.url.endsWith('/api/dsh/workspaces'));
		expect(JSON.parse(String(create!.init!.body))).toEqual({ path: '/Users/op/x' });
	});

	it('bare /workspace → the usage note, zero wire traffic', async () => {
		const { calls } = stubFetch([]);
		const result = await executeCommand(parseCommand('/workspace')!, ctx());
		expect(result.ok).toBe(false);
		expect(result.note).toBe('usage: /workspace <full-path> [name]');
		expect(calls).toHaveLength(0);
	});

	it('relative path → usage note BEFORE any RPC (D3)', async () => {
		const { calls } = stubFetch([]);
		const result = await executeCommand(parseCommand('/workspace relative/dir')!, ctx());
		expect(result.ok).toBe(false);
		expect(result.note).toContain('absolute or ~ path');
		expect(calls).toHaveLength(0);
	});

	it('host refusal (missing folder) → honest note naming the mkdir remedy; no retry, no rename (D4)', async () => {
		const { calls } = stubFetch([
			{
				test: (url) => url.endsWith('/api/dsh/directory'),
				respond: () =>
					jsonRes({ ok: true, listing: { home: '/home/u', crumbs: [], entries: [], truncated: false } })
			},
			{
				test: (url) => url.endsWith('/api/dsh/workspaces'),
				respond: () => jsonRes({ ok: false, error: { code: 'workspace/not-found', message: 'no such directory' } }, 502)
			}
		]);
		const result = await executeCommand(parseCommand('/workspace ~/nope ws')!, ctx());
		expect(result.ok).toBe(false);
		expect(result.note).toContain('no such directory');
		expect(result.note).toContain('mkdir');
		const workspaces = calls.filter((c) => c.url.includes('/workspaces'));
		expect(workspaces).toHaveLength(1); // create only — no retry, no rename
	});

	it('created=false → already-adopted note, NO rename call (D2)', async () => {
		const { calls } = stubFetch([
			{
				test: (url) => url.endsWith('/api/dsh/workspaces'),
				respond: () =>
					jsonRes({
						ok: true,
						created: false,
						workspace: { workspaceId: 'ws-3', title: 'existing', path: '/w/proj' }
					})
			}
		]);
		const result = await executeCommand(parseCommand('/workspace /w/proj NewName')!, ctx());
		expect(result.ok).toBe(true);
		expect(result.note).toContain('already adopted as "existing"');
		expect(result.note).toContain('chip menu');
		expect(calls.find((c) => c.url.includes('/rename'))).toBeUndefined();
	});

	it('rename failure after create → "adopted but rename failed" framing, host message verbatim (D2)', async () => {
		stubFetch([
			{
				test: (url) => url.endsWith('/api/dsh/workspaces'),
				respond: () =>
					jsonRes({
						ok: true,
						created: true,
						workspace: { workspaceId: 'ws-4', title: 'x', path: '/w/x' }
					})
			},
			{
				test: (url) => url.includes('/rename'),
				respond: () => jsonRes({ ok: false, error: { code: 'workspace/name-conflict', message: 'name taken' } }, 502)
			}
		]);
		const result = await executeCommand(parseCommand('/workspace /w/x taken')!, ctx());
		expect(result.ok).toBe(true); // the ADOPTION stands
		expect(result.note).toContain('adopted /w/x');
		expect(result.note).toContain('rename to "taken" failed');
		expect(result.note).toContain('name taken');
	});

	it('home fetch failure on a ~ path → honest note, never a crash (D3)', async () => {
		const { calls } = stubFetch([
			{
				test: (url) => url.endsWith('/api/dsh/directory'),
				respond: () => jsonRes({ ok: false }, 500)
			}
		]);
		const result = await executeCommand(parseCommand('/workspace ~/x')!, ctx());
		expect(result.ok).toBe(false);
		expect(result.note).toContain('could not read the host home');
		expect(result.note).toContain('HTTP 500'); // the host's own refusal rides the note
		expect(result.note).toContain('absolute path'); // the remedy
		expect(calls.every((c) => !c.url.includes('/workspaces'))).toBe(true); // nothing sent with a raw ~
	});
});

// ── 2.2-T — the /new ws-resolution branch (D5) + F11 ────────────────────

describe('executeCommand — /new workspace token (D5 resolution)', () => {
	const REGISTRY = {
		test: (url: string, init?: RequestInit) =>
			url.endsWith('/api/dsh/sessions') && (init?.method ?? 'GET') === 'GET',
		respond: () =>
			jsonRes({
				ok: true,
				sessions: [],
				workspaces: [
					{ workspaceId: 'wa', title: 'recipe-ws', path: '/home/u/recipe-ws', sessionIds: [] },
					{ workspaceId: 'wb', title: 'other', path: '/home/u/other', sessionIds: [] }
				],
				presets: []
			})
	};

	it('unique title match → the create carries THAT cwd (displaces inheritance)', async () => {
		const { calls } = stubFetch([REGISTRY, SESSIONS_POST]);
		const swaps: unknown[] = [];
		registerReplacePanel(() => {
			swaps.push(1);
			return true;
		});

		const result = await executeCommand(parseCommand('/new @ptc recipe-ws')!, ctx({ workspace: '/w/inherited' }));

		expect(result).toEqual({ ok: true, newSessionId: NEW_ID });
		const create = calls.find((c) => c.url.endsWith('/api/dsh/sessions') && c.init?.method === 'POST');
		expect(JSON.parse(String(create!.init!.body))).toEqual({ cwd: '/home/u/recipe-ws', agentPreset: 'ptc' });
	});

	it('exact canonical path token → canon match, same displacement', async () => {
		const { calls } = stubFetch([REGISTRY, SESSIONS_POST]);
		registerReplacePanel(() => true);

		await executeCommand(parseCommand('/new /home/u/other')!, ctx());

		const create = calls.find((c) => c.url.endsWith('/api/dsh/sessions') && c.init?.method === 'POST');
		expect(JSON.parse(String(create!.init!.body))).toEqual({ cwd: '/home/u/other', agentPreset: 'main' });
	});

	it('ambiguous title → candidates note (path + title), NO create POST (never a guess)', async () => {
		const { calls } = stubFetch([
			{
				test: (url, init) => (init?.method ?? 'GET') === 'GET' && url.endsWith('/api/dsh/sessions'),
				respond: () =>
					jsonRes({
						ok: true,
						sessions: [],
						workspaces: [
							{ workspaceId: 'a', title: 'dup', path: '/w/a', sessionIds: [] },
							{ workspaceId: 'b', title: 'dup', path: '/w/b', sessionIds: [] }
						],
						presets: []
					})
			}
		]);
		const result = await executeCommand(parseCommand('/new dup')!, ctx());
		expect(result.ok).toBe(false);
		expect(result.note).toContain('/w/a');
		expect(result.note).toContain('/w/b');
		expect(result.note).toContain('matches several workspaces');
		expect(calls.find((c) => c.init?.method === 'POST')).toBeUndefined();
	});

	it('no match → note naming the registry and the /workspace pointer', async () => {
		stubFetch([REGISTRY]);
		const result = await executeCommand(parseCommand('/new nowhere')!, ctx());
		expect(result.ok).toBe(false);
		expect(result.note).toContain('no workspace "nowhere"');
		expect(result.note).toContain('/workspace');
	});

	it('F11: bare /new with NO current workspace → success + the ungrouped note pointing at /workspace', async () => {
		const { calls } = stubFetch([SESSIONS_POST]);
		registerReplacePanel(() => true);
		const result = await executeCommand(parseCommand('/new')!, ctx({ workspace: null }));
		expect(result.ok).toBe(true);
		expect(result.note).toContain('UNGROUPED');
		expect(result.note).toContain('/workspace');
		const create = calls.find((c) => c.init?.method === 'POST');
		expect(JSON.parse(String(create!.init!.body))).toEqual({ agentPreset: 'main' }); // no cwd key
	});

	it('bare /new WITH a current workspace → inherited cwd unchanged, NO note (regression)', async () => {
		const { calls } = stubFetch([SESSIONS_POST]);
		registerReplacePanel(() => true);
		const result = await executeCommand(parseCommand('/new')!, ctx({ workspace: '/w/proj' }));
		expect(result).toEqual({ ok: true, newSessionId: NEW_ID });
		const create = calls.find((c) => c.init?.method === 'POST');
		expect(JSON.parse(String(create!.init!.body))).toEqual({ cwd: '/w/proj', agentPreset: 'main' });
	});
});
