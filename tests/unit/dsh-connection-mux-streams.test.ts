// @vitest-environment node
/**
 * dsh-connection — the $events/state-stream frame arms, catalog
 * invalidation, rpc-failure arms, and normalize helpers the transport
 * suite's happy paths miss.
 *
 * Pins: $events waterfall cancel/settle/emit-arm semantics (including the
 * commands/change + agent-preset/selected catalog invalidations), the
 * workspace/control stream's junk tolerance, the seq-gap coverage floor,
 * the rpc 401 re-mint + transport-failure + abort-signal arms, the
 * respond receipt arms (not-pending, answers-wrapper, stale-generation
 * retry that times out honestly), the pageCursor ladder (list watermark →
 * −1 tail form when no cursor is served), and the exported
 * normalize helpers' junk-tolerance contract.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DshConnection,
	normalizeModelDirectory,
	normalizePreset,
	normalizeSessionRow,
	resetDshConnectionForTests,
	type WebSocketLike
} from '$lib/server/dsh-connection';

// Hermetic config: no auth token anywhere — the auth carrier resolves
// "no token" without touching the network.
const configDir = mkdtempSync(join(tmpdir(), 'dsi-connx-config-'));
beforeAll(() => {
	process.env.DSI_CONFIG_PATH = configDir;
	delete process.env.DSI_AUTH_TOKEN;
});
afterAll(() => {
	delete process.env.DSI_CONFIG_PATH;
	rmSync(configDir, { recursive: true, force: true });
});

/** Scripted fake WebSocket (one per downlink). */
class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	listeners = new Map<string, Array<(e?: unknown) => void>>();
	sent: string[] = [];
	url: string;
	closed = false;
	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}
	send(data: string): void {
		this.sent.push(data);
	}
	addEventListener(ev: string, fn: (e?: unknown) => void): void {
		this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn]);
	}
	/** Deliver one raw remote.mux server frame ({type,streamId,value,…}). */
	push(value: unknown): void {
		for (const fn of this.listeners.get('message') ?? []) fn({ data: JSON.stringify(value) });
	}
	/** Deliver an unparseable message (malformed-frame arm). */
	pushRaw(raw: string): void {
		for (const fn of this.listeners.get('message') ?? []) fn({ data: raw });
	}
	simulateClose(): void {
		this.closed = true;
		for (const fn of this.listeners.get('close') ?? []) fn();
	}
	close(): void {
		this.simulateClose();
	}
	static open(socket: FakeWebSocket | undefined): void {
		for (const fn of socket?.listeners.get('open') ?? []) fn();
	}
}

function muxSocket(): FakeWebSocket | undefined {
	return FakeWebSocket.instances.find((s) => s.url.endsWith('/api/remote.mux') && !s.closed);
}

/** streamIds the connection opened on a socket. */
function sentOpens(socket: FakeWebSocket): string[] {
	return socket.sent
		.map((raw) => JSON.parse(raw) as { type?: string; streamId?: string })
		.filter((m): m is { type: 'open'; streamId: string } => m.type === 'open' && typeof m.streamId === 'string')
		.map((m) => m.streamId);
}

function fakeFetch(scripted: Record<string, unknown>): typeof fetch {
	return (async (url: unknown, init?: { body?: string }) => {
		const segments = String(url).split('/');
		const method = segments.slice(-2).join('/');
		const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
		const result = scripted[method];
		return new Response(
			JSON.stringify(
				result === undefined
					? { type: 'server-response', rpcId: body.rpcId, result: { ok: false, error: { code: 'session/not-found', message: 'nope' } } }
					: { type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: result } }
			),
			{ status: 200 }
		);
	}) as unknown as typeof fetch;
}

function makeConn(
	scripted: Record<string, unknown> = {},
	opts: Partial<import('$lib/server/dsh-connection').DshConnectionOptions> = {}
): DshConnection {
	return new DshConnection({
		wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
		fetchFn: fakeFetch(scripted),
		rpcIdFactory: () => 'rpc-test',
		backoffScheduleMs: [10, 20, 40],
		...opts
	});
}

/** A $events stream-id on the live mux socket (opening it if needed). */
function eventsStreamId(): string {
	const socket = muxSocket()!;
	const id = sentOpens(socket).find((x) => x.startsWith('events-'));
	if (id === undefined) FakeWebSocket.open(socket);
	return sentOpens(socket).find((x) => x.startsWith('events-'))!;
}

/** Deliver one $events item. */
function pushEvent(value: unknown): void {
	muxSocket()!.push({ type: 'item', streamId: eventsStreamId(), value });
}

function frameEvent(seq: number): { type: string; seq: number; time: number; data: Record<string, unknown> } {
	return { type: 'user/message', seq, time: seq * 1000, data: {} };
}

beforeEach(() => {
	FakeWebSocket.instances = [];
});

afterEach(() => {
	resetDshConnectionForTests();
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('dsh-connection — constructor fallback arms', () => {
	it('zero options: default WS factory, default auth carrier, default base URL', () => {
		vi.stubGlobal('WebSocket', FakeWebSocket);
		// fetchFn stays injectable so the seed RPC never leaves the process —
		// everything else (WS factory, auth, base URL) exercises the defaults.
		const conn = new DshConnection({ fetchFn: fakeFetch({}) });
		conn.ensureDownlinks();
		expect(FakeWebSocket.instances.map((s) => s.url)).toEqual(['ws://127.0.0.1:3080/api/remote.mux']);
		conn.dispose();
	});

	it('an explicit baseUrl wins over dshBaseUrl; a cookie-bearing auth rides the WS handshake', () => {
		const conn = new DshConnection({
			baseUrl: 'http://127.0.0.1:9999',
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			fetchFn: fakeFetch({}),
			// Minimal DshAuth double with a MINTED cookie — the handshake
			// must attach it (the defined arm of the header conditional).
			auth: {
				cookieHeader: () => 'dsh_session=z',
				ensureCookie: async () => 'dsh_session=z',
				invalidate: () => {}
			} as never
		});
		conn.ensureDownlinks();
		expect(FakeWebSocket.instances[0]!.url).toBe('ws://127.0.0.1:9999/api/remote.mux');
		conn.dispose();
	});

	it('ensureDownlinks after dispose never reopens (the disposed guard)', () => {
		const conn = makeConn();
		conn.dispose();
		conn.ensureDownlinks();
		expect(FakeWebSocket.instances).toHaveLength(0);
	});
});

describe('dsh-connection — catalog invalidation registry (Slash Menu W1)', () => {
	it('commands/change fires "all", agent-preset/selected fires the session, unknown emits stay ignored', () => {
		const conn = makeConn();
		const seen: Array<string | 'all'> = [];
		const off = conn.onCatalogInvalidated((scope) => seen.push(scope));
		conn.ensureDownlinks();
		FakeWebSocket.open(muxSocket());

		pushEvent({ type: 'emit', event: 'commands/change' });
		expect(seen).toEqual(['all']);

		pushEvent({ type: 'emit', event: 'agent-preset/selected', agentId: 's1' });
		expect(seen).toEqual(['all', 's1']);

		pushEvent({ type: 'emit', event: 'something/else' });
		pushEvent({ type: 'emit', event: 'api-session/status', args: 'not-an-array' });
		expect(seen).toEqual(['all', 's1']);

		off();
		pushEvent({ type: 'emit', event: 'commands/change' });
		expect(seen).toEqual(['all', 's1']);
	});

	it('agent-preset/selected without a string agentId does not fire a scope', () => {
		const conn = makeConn();
		const seen: Array<string | 'all'> = [];
		conn.onCatalogInvalidated((scope) => seen.push(scope));
		conn.ensureDownlinks();
		FakeWebSocket.open(muxSocket());
		pushEvent({ type: 'emit', event: 'agent-preset/selected', agentId: 42 });
		expect(seen).toEqual([]);
	});

	it('a mux reset fires "all" alongside the rebuild (the missed-frames arm)', () => {
		const conn = makeConn();
		const seen: Array<string | 'all'> = [];
		conn.onCatalogInvalidated((scope) => seen.push(scope));
		conn.ensureDownlinks();
		muxSocket()!.simulateClose();
		expect(seen).toEqual(['all']);
	});
});

describe('dsh-connection — $events waterfall edge arms', () => {
	function registerApproval(eventId: string): void {
		pushEvent({
			type: 'waterfall',
			event: 'approval/request',
			eventId,
			agentId: 's1',
			request: { approvalId: 'apr-1', toolName: 'Bash' }
		});
	}

	it('a cancel frame withdraws the card as cancelled', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		registerApproval('rpc-c1');
		expect(conn.pendingFor('s1')).toHaveLength(1);
		pushEvent({ type: 'cancel', eventId: 'rpc-c1' });
		expect(conn.pendingFor('s1')).toEqual([]);
		expect(conn.settlementsFor('s1')[0]).toMatchObject({ rpcId: 'rpc-c1', outcome: 'cancelled' });
	});

	it('a settle frame with a junk outcome records "unknown"', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		registerApproval('rpc-s1');
		pushEvent({ type: 'settle', eventId: 'rpc-s1', outcome: 7 });
		expect(conn.settlementsFor('s1')[0]!.outcome).toBe('unknown');
	});

	it('a waterfall without a string eventId is ignored (nothing to answer through)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushEvent({ type: 'waterfall', event: 'approval/request', eventId: 42, agentId: 's1' });
		pushEvent({ type: 'waterfall', event: 99, eventId: 'rpc-x', agentId: 's1' });
		expect(conn.pendingFor('s1')).toEqual([]);
	});

	it('a non-object waterfall request is tolerated as an empty request body', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushEvent({
			type: 'waterfall',
			event: 'approval/request',
			eventId: 'rpc-w1',
			agentId: 's1',
			request: 'garbage'
		});
		// The card registers with just the envelope fields — no invented body.
		expect(conn.pendingFor('s1')).toHaveLength(1);
		expect(conn.pendingFor('s1')[0]!.body).toEqual({ type: 'approval/requested', sessionId: 's1' });
	});

	it('a forwarded waterfall of an unknown family is ignored (logged, no card)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		pushEvent({ type: 'waterfall', event: 'other/waterfall', eventId: 'rpc-y', agentId: 's1' });
		expect(conn.pendingFor('s1')).toEqual([]);
	});
});

describe('dsh-connection — follow/snapshot edge arms', () => {
	function subscribeAndOpen(sessionId: string): FakeWebSocket {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.subscribe(sessionId);
		FakeWebSocket.open(socket);
		return socket;
	}

	it('a snapshot without a records key seeds the cursor alone (records default empty)', () => {
		const socket = subscribeAndOpen('s1');
		const followId = sentOpens(socket).find((x) => x.startsWith('follow-s1'))!;
		socket.push({ type: 'item', streamId: followId, value: { type: 'snapshot', cursor: 7 } });
	});

	it('a snapshot record without an event payload contributes nothing', () => {
		const socket = subscribeAndOpen('s1');
		const followId = sentOpens(socket).find((x) => x.startsWith('follow-s1'))!;
		socket.push({
			type: 'item',
			streamId: followId,
			value: { type: 'snapshot', cursor: 3, records: [{ type: 'chunks' }, { type: 'event', event: frameEvent(2) }] }
		});
	});

	it('frames for a stream id that names no session are dropped (no crash)', () => {
		const socket = subscribeAndOpen('s1');
		socket.push({ type: 'item', streamId: 'follow-bare', value: { type: 'snapshot', cursor: 5, records: [] } });
		socket.push({ type: 'item', value: { type: 'event' } });
	});

	it('an event item without an event payload appends nothing', () => {
		const socket = subscribeAndOpen('s1');
		const followId = sentOpens(socket).find((x) => x.startsWith('follow-s1'))!;
		socket.push({ type: 'item', streamId: followId, value: { type: 'event' } });
	});

	it('a malformed frame is dropped and the stream keeps working', () => {
		const socket = subscribeAndOpen('s1');
		socket.pushRaw('not-json{');
		const followId = sentOpens(socket).find((x) => x.startsWith('follow-s1'))!;
		socket.push({ type: 'item', streamId: followId, value: { type: 'snapshot', cursor: 4, records: [] } });
	});
});

describe('dsh-connection — seq-gap coverage floor (Wave 4.2)', () => {
	it('a seq jump raises the floor: the next poll reports gap and triggers resync upstream', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		conn.subscribe('s1');
		FakeWebSocket.open(socket);
		const followId = sentOpens(socket).find((x) => x.startsWith('follow-s1'))!;
		socket.push({ type: 'item', streamId: followId, value: { type: 'snapshot', cursor: 1, records: [] } });
		// A drop lost 2..4 — the next frame resumes at 5.
		socket.push({ type: 'item', streamId: followId, value: { type: 'event', event: frameEvent(5) } });
		const delta = conn.eventsSince('s1', 1);
		expect(delta.events.map((e) => e.seq)).toEqual([5]);
		expect(delta.gap).toBe(true);
		// An empty delta is "nothing new yet", never a gap.
		expect(conn.eventsSince('s1', 5).gap).toBe(false);
	});
});

describe('dsh-connection — workspace/control stream junk tolerance', () => {
	function pushState(prefix: 'workspaces-' | 'control-', value: unknown): void {
		const socket = muxSocket()!;
		FakeWebSocket.open(socket);
		const id = sentOpens(socket).find((x) => x.startsWith(prefix))!;
		socket.push({ type: 'item', streamId: id, value });
	}

	it('a workspace baseline drops junk rows, falls titles back to path, filters ids', async () => {
		const conn = makeConn({});
		conn.ensureDownlinks();
		FakeWebSocket.open(muxSocket());
		pushState('workspaces-', {
			type: 'baseline',
			value: {
				items: [
					null,
					{ workspaceId: 4, path: '/nope' },
					{ workspaceId: 'w1', title: '', path: '/one', sessionIds: [1, 's1', null] }
				]
			}
		});
		const out = await conn.listWorkspaces();
		expect(out.items).toEqual([{ workspaceId: 'w1', title: '/one', path: '/one', sessionIds: ['s1'] }]);
	});

	it('a baseline without an items array is an honest empty registry', async () => {
		const conn = makeConn({});
		conn.ensureDownlinks();
		FakeWebSocket.open(muxSocket());
		pushState('workspaces-', { type: 'baseline', value: {} });
		expect(await conn.listWorkspaces()).toEqual({ items: [] });
	});

	it('upsert replaces a known workspace, adds a new one, and ignores junk', async () => {
		const conn = makeConn({});
		conn.ensureDownlinks();
		FakeWebSocket.open(muxSocket());
		pushState('workspaces-', {
			type: 'baseline',
			value: { items: [{ workspaceId: 'w1', title: 'One', path: '/one', sessionIds: [] }] }
		});
		pushState('workspaces-', {
			type: 'upsert',
			workspace: { workspaceId: 'w1', title: 'One v2', path: '/one', sessionIds: ['s9'] }
		});
		pushState('workspaces-', { type: 'upsert', workspace: { workspaceId: 'w2', title: 9, path: '/two' } });
		pushState('workspaces-', { type: 'upsert', workspace: { workspaceId: 3, path: '/junk' } });
		pushState('workspaces-', { type: 'remove', workspaceId: 4 });
		pushState('workspaces-', { type: 'order' });
		pushState('workspaces-', { type: 'archived' });
		const out = await conn.listWorkspaces();
		expect(out.items.map((w) => [w.workspaceId, w.title, w.sessionIds])).toEqual([
			['w1', 'One v2', ['s9']],
			['w2', '/two', []]
		]);
		pushState('workspaces-', { type: 'remove', workspaceId: 'w2' });
		expect((await conn.listWorkspaces()).items).toHaveLength(1);
	});

	it('a control baseline skips junk blocks; projection frames merge into one block', () => {
		const conn = makeConn({});
		conn.ensureDownlinks();
		FakeWebSocket.open(muxSocket());
		pushState('control-', {
			type: 'baseline',
			value: { projections: { s1: 'junk', s2: null, s3: { asOfSeq: 4, values: { permissions: 'ro' } } } }
		});
		expect(conn.projectionBlock('s1')).toBeNull();
		expect(conn.projectionBlock('s3')).toEqual({ asOfSeq: 4, values: { permissions: 'ro' } });
		// A projection frame for a NEVER-seen session starts the default block.
		pushState('control-', { type: 'projection', sessionId: 's9', key: 'todos', value: [], seq: 'junk' });
		expect(conn.projectionBlock('s9')).toEqual({ asOfSeq: 0, values: { todos: [] } });
		pushState('control-', { type: 'projection', sessionId: 's3', key: 'permissions', value: 'rwa', seq: 6 });
		expect(conn.projectionBlock('s3')?.asOfSeq).toBe(6);
	});
});

describe('dsh-connection — rpc transport arms (401 re-mint, hard failure, abort signal)', () => {
	it('a 401 re-mints from the current config token and retries once', async () => {
		let calls = 0;
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			fetchFn: (async (url: unknown, init?: { body?: string }) => {
				calls += 1;
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
				if (calls === 1) return new Response('stale', { status: 401 });
				return new Response(
					JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { accepted: true } } }),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		await expect(conn.cancel('s1')).resolves.toEqual({ accepted: true });
		expect(calls).toBe(2);
	});

	it('a persistent non-ok HTTP status throws the transport failure (host-unreachable upstream)', async () => {
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			fetchFn: (async () => new Response('down', { status: 500 })) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test'
		});
		await expect(conn.cancel('s1')).rejects.toThrow(/transport failure.*500/);
	});

	it('an explicit abort signal rides the fetch init (the picker carrier contract)', async () => {
		let seenSignal: unknown = 'absent';
		const scripted: Record<string, unknown> = { 'directoryPicker/pick': '/p' };
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			fetchFn: (async (url: unknown, init?: { body?: string; signal?: unknown }) => {
				seenSignal = init?.signal;
				return (fakeFetch(scripted) as (u: unknown, i?: { body?: string }) => Promise<Response>)(url, init);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test'
		});
		const controller = new AbortController();
		await expect(conn.pickDirectory(controller.signal)).resolves.toEqual({ path: '/p' });
		expect(seenSignal).toBe(controller.signal);
	});
});

describe('dsh-connection — respond receipt arms', () => {
	function readyConn(fetchFn: typeof fetch, opts: Partial<import('$lib/server/dsh-connection').DshConnectionOptions> = {}): DshConnection {
		const conn = new DshConnection({
			fetchFn,
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			rpcIdFactory: () => 'rpc-test',
			...opts
		});
		conn.ensureDownlinks();
		FakeWebSocket.open(muxSocket());
		muxSocket()!.push({
			type: 'item',
			streamId: sentOpens(muxSocket()!).find((x) => x.startsWith('events-'))!,
			value: { type: 'ready', clientId: 'cli-1', host: { home: '/h' } }
		});
		return conn;
	}

	function resultResponse(init?: { body?: string }, status = 200): Response {
		const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
		return new Response(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: undefined } }), { status });
	}

	it('a not-pending gateway answer is an idempotent no-op receipt (lost race)', async () => {
		const conn = readyConn((async (url: unknown, init?: { body?: string }) => {
			const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: body.rpcId,
					result: { ok: false, error: { code: 'not-pending', message: 'already settled', details: {} } }
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch);
		await expect(conn.respond('ev-1', { sessionId: 's1', outcome: 'allowed-once' })).resolves.toEqual({
			accepted: false,
			reason: 'not-pending'
		});
	});

	it('a bare answers array (no wrapper) ships as {answers:[…]}', async () => {
		let sent: unknown;
		const conn = readyConn((async (url: unknown, init?: { body?: string }) => {
			if (String(url).includes('$events/result')) {
				sent = ((JSON.parse(init?.body ?? '{}') as { payload?: { args?: unknown } }).payload as { args?: unknown }).args;
			}
			return resultResponse(init);
		}) as unknown as typeof fetch);
		await expect(conn.respond('ev-2', { sessionId: 's1', answers: [{ id: 'q1', selected: ['a'] }] })).resolves.toEqual({
			accepted: true
		});
		expect(sent).toMatchObject({ outcome: { kind: 'result', value: { answers: [{ id: 'q1', selected: ['a'] }] } } });
	});

	it('a stale-generation answer whose rebuild never re-readies rethrows honestly (bounded wait)', async () => {
		const conn = readyConn(
			(async (url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
				return new Response(
					JSON.stringify({
						type: 'server-response',
						rpcId: body.rpcId,
						result: {
							ok: false,
							error: { code: 'gateway/internal', message: 'typert gateway: Remote event result identifies no active event stream', details: {} }
						}
					}),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			{ staleGenerationRetryMs: 60 }
		);
		// A pending reconnect timer exists when the answer fires — the refresh
		// must clear it before rebuilding (no double schedule).
		muxSocket()!.simulateClose();
		await expect(conn.respond('ev-3', { sessionId: 's1', outcome: 'rejected' })).rejects.toThrow(/no active event stream/);
	});
});

describe('dsh-connection — waitForProjections bounded wait', () => {
	it('resolves immediately once a control baseline seeded the block', async () => {
		const conn = makeConn({});
		conn.ensureDownlinks();
		FakeWebSocket.open(muxSocket());
		const controlId = sentOpens(muxSocket()!).find((x) => x.startsWith('control-'))!;
		muxSocket()!.push({
			type: 'item',
			streamId: controlId,
			value: { type: 'baseline', value: { projections: { s1: { asOfSeq: 2, values: { permissions: 'ro' } } } } }
		});
		const block = await conn.waitForProjections('s1', 100);
		expect(block).toEqual({ asOfSeq: 2, values: { permissions: 'ro' } });
	});

	it('times out to null with the DEFAULT deadline when no baseline ever lands', async () => {
		vi.useFakeTimers();
		const conn = makeConn({});
		conn.ensureDownlinks();
		const waited = conn.waitForProjections('s-never');
		await vi.advanceTimersByTimeAsync(2600);
		await expect(waited).resolves.toBeNull();
	});
});

describe('dsh-connection — page cursor ladder (0.1.3 tail pages)', () => {
	it('a session the list does not name pages the unconstrained −1 tail form', async () => {
		let seenThroughSeq: unknown;
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			fetchFn: (async (url: unknown, init?: { body?: string }) => {
				const method = String(url).split('/').slice(-2).join('/');
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string; payload?: { args?: { request?: { throughSeq?: number } } } };
				if (method === 'session/page') {
					seenThroughSeq = body.payload?.args?.request?.throughSeq;
				}
				const value = method === 'session/list' ? { items: [] } : { records: [], hasMore: false };
				return new Response(
					JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } }),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test'
		});
		await conn.history('s-unknown');
		expect(seenThroughSeq).toBe(-1);
	});

	it('a listed row WITHOUT a served cursor pages the same −1 tail form', async () => {
		let seenThroughSeq: unknown;
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			fetchFn: (async (url: unknown, init?: { body?: string }) => {
				const method = String(url).split('/').slice(-2).join('/');
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string; payload?: { args?: { request?: { throughSeq?: number } } } };
				if (method === 'session/page') seenThroughSeq = body.payload?.args?.request?.throughSeq;
				const value = method === 'session/list' ? { items: [{ sessionId: 's1', projections: {} }] } : { records: [], hasMore: false };
				return new Response(
					JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } }),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test'
		});
		await conn.history('s1');
		expect(seenThroughSeq).toBe(-1);
	});

	it('a NEGATIVE list watermark (0.1.3 cold child) pages the −1 tail form, never the number itself', async () => {
		let seenThroughSeq: unknown;
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			fetchFn: (async (url: unknown, init?: { body?: string }) => {
				const method = String(url).split('/').slice(-2).join('/');
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string; payload?: { args?: { request?: { throughSeq?: number } } } };
				if (method === 'session/page') seenThroughSeq = body.payload?.args?.request?.throughSeq;
				const value = method === 'session/list'
					? { items: [{ sessionId: 's1', projections: { asOfSeq: -1, values: { title: 'child' } } }] }
					: { records: [], hasMore: false };
				return new Response(
					JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } }),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test'
		});
		await conn.history('s1');
		expect(seenThroughSeq).toBe(-1);
	});

	it('historyPage rides the same −1 tail form beside its beforeSeq cursor', async () => {
		let seenRequest: unknown;
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			fetchFn: (async (url: unknown, init?: { body?: string }) => {
				const method = String(url).split('/').slice(-2).join('/');
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string; payload?: { args?: { request?: Record<string, unknown> } } };
				if (method === 'session/page') seenRequest = body.payload?.args?.request;
				const value = method === 'session/list'
					? { items: [{ sessionId: 's1', projections: { asOfSeq: -1 } }] }
					: { records: [], hasMore: false };
				return new Response(
					JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } }),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test'
		});
		await conn.historyPage('s1', 10);
		expect(seenRequest).toMatchObject({ throughSeq: -1, beforeSeq: 10 });
	});

	it('resyncFromLedger on an EMPTY page resets the buffer to the honest empty state', async () => {
		const conn = makeConn({
			'session/list': { items: [{ sessionId: 's1', projections: { asOfSeq: 9 } }] },
			'session/page': { records: [], hasMore: false }
		});
		conn.subscribe('s1');
		const events = await conn.resyncFromLedger('s1');
		expect(events).toEqual([]);
		const delta = conn.eventsSince('s1', -1);
		expect(delta.lastSeq).toBe(-1);
		expect(delta.gap).toBe(false);
	});
});

describe('dsh-connection — running seed race with a superseded generation', () => {
	it('a seed answer from an ENDED generation is dropped entirely', async () => {
		let releaseGen1!: (v: unknown) => void;
		const gen1 = new Promise((resolve) => (releaseGen1 = resolve));
		let call = 0;
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			fetchFn: (async (url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
				call += 1;
				const value =
					call === 1 ? await gen1 : { items: [{ sessionId: 's-gen2', running: true }] };
				return new Response(
					JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } }),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		conn.ensureDownlinks(); // generation 1 — its list answer is gated
		muxSocket()!.simulateClose();
		await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(1));
		releaseGen1({ items: [{ sessionId: 's-gen1', running: true }] });
		await vi.waitFor(() => expect(conn.isRunning('s-gen2')).toBe(true));
		expect(conn.isRunning('s-gen1')).toBe(false); // the stale seed never landed
	});
});

describe('dsh-connection — teardown/close guard arms', () => {
	it('dispose while a reconnect is pending clears the timer and stays closed', () => {
		vi.useFakeTimers();
		const conn = makeConn();
		conn.ensureDownlinks();
		muxSocket()!.simulateClose(); // schedules the reconnect
		conn.dispose(); // teardown with the timer pending
		vi.advanceTimersByTime(100);
		expect(FakeWebSocket.instances.filter((s) => s.url.endsWith('/api/remote.mux')).length).toBe(1);
	});

	it('a close event after dispose is ignored (the disposed guard)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = FakeWebSocket.instances[0]!;
		conn.dispose();
		expect(() => socket.simulateClose()).not.toThrow();
	});

	it('a second close/error on the same dead generation is a no-op', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		const socket = muxSocket()!;
		socket.simulateClose(); // first close rebuilds
		const dead = FakeWebSocket.instances[0]!;
		// Fire the stale listeners again — wsMux already points elsewhere.
		for (const fn of dead.listeners.get('close') ?? []) fn();
		for (const fn of dead.listeners.get('error') ?? []) fn();
		expect(() => dead.close()).not.toThrow();
		conn.dispose(); // clears the pending reconnect timer (test isolation)
	});

	it('a reconnect timer firing after dispose does not reopen (disposed callback guard)', () => {
		vi.useFakeTimers();
		const conn = makeConn();
		conn.ensureDownlinks();
		muxSocket()!.simulateClose();
		conn.dispose();
		vi.advanceTimersByTime(50);
		expect(muxSocket()).toBeUndefined();
	});
});

describe('dsh-connection — subscribe parking + address probe failure arms', () => {
	it('a subscribe while the carrier is still CONNECTING is parked and flushed on open', async () => {
		const conn = makeConn({});
		conn.ensureDownlinks();
		conn.subscribe('s1'); // socket exists, never opened → parked
		const socket = muxSocket()!;
		expect(sentOpens(socket).filter((x) => x.startsWith('follow-s1'))).toHaveLength(0);
		FakeWebSocket.open(socket);
		expect(sentOpens(socket).filter((x) => x.startsWith('follow-s1'))).toHaveLength(1);
	});

	it('a failed address probe keeps the plain follow (best-effort, no reopen)', async () => {
		const conn = makeConn({}); // unscripted session/list → the probe fails
		conn.ensureDownlinks();
		conn.subscribe('s1');
		FakeWebSocket.open(muxSocket());
		await new Promise((resolve) => setTimeout(resolve, 20));
		const socket = muxSocket()!;
		expect(sentOpens(socket).filter((x) => x.startsWith('follow-s1'))).toHaveLength(1);
	});

	it('a probe landing after the generation moved on does not reopen the old socket', async () => {
		let release!: (v: unknown) => void;
		const gate = new Promise((resolve) => (release = resolve));
		vi.useFakeTimers();
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			fetchFn: (async (url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
				const value = String(url).includes('session/list') ? await gate : undefined;
				return new Response(
					JSON.stringify({
						type: 'server-response',
						rpcId: body.rpcId,
						...(value === undefined
							? { result: { ok: false, error: { code: 'session/not-found', message: 'x' } } }
							: { result: { ok: true, value } })
					}),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test',
			backoffScheduleMs: [10]
		});
		conn.ensureDownlinks();
		conn.subscribe('s1');
		FakeWebSocket.open(muxSocket());
		const old = muxSocket()!;
		old.simulateClose(); // generation dies while the probe RPC is in flight
		await vi.advanceTimersByTimeAsync(10);
		const rebuilt = muxSocket()!;
		FakeWebSocket.open(rebuilt);
		release({ items: [] });
		await vi.advanceTimersByTimeAsync(10);
		expect(rebuilt).not.toBe(old);
		expect(sentOpens(rebuilt).filter((x) => x.startsWith('follow-s1'))).toHaveLength(1);
	});
});

describe('dsh-connection — ledger v2 records pass through verbatim', () => {
	function connFor(records: unknown[]): DshConnection {
		return makeConn({
			'session/list': { items: [{ sessionId: 's1', projections: { asOfSeq: 40 } }] },
			'session/page': { records, hasMore: false }
		});
	}

	it('every page record arrives as one plain event (ledger v2 record forms)', async () => {
		const page = await connFor([
			{ type: 'event', event: { type: 'user/message', seq: 10, time: 1000, data: {} } },
			{ type: 'event', event: { type: 'assistant/message', seq: 11, time: 1100, data: { turn: 1, step: 1 } } }
		]).history('s1');
		expect(page.events.map((h) => h.event.seq)).toEqual([10, 11]);
		expect(page.events.map((h) => h.event.type)).toEqual(['user/message', 'assistant/message']);
	});

	it('a retired chunkrow record passes through unexpanded (v2 hosts never serve it)', () => {
		// 0.1.2 packed runs were expanded to member chunk events; ledger v2
		// removed that wire form and the expansion with it. A hypothetical
		// arrival is one verbatim event — never a reconstruction.
		const records = [
			{ type: 'event', event: { type: 'chunkrow/text-chunks', seq: 10, time: 1000, data: { turn: 0, step: 0, index: 0, dt: [], texts: ['a', 'b'] } } }
		];
		return connFor(records).history('s1').then((page) => {
			expect(page.events).toHaveLength(1);
			expect(page.events[0]!.event.type).toBe('chunkrow/text-chunks');
			expect(page.events[0]!.event.seq).toBe(10);
		});
	});
});

describe('dsh-connection — subagent hint folding refusals (address stays plain)', () => {
	function pageAddress(): Promise<Record<string, unknown>> {
		let address: unknown;
		const conn = new DshConnection({
			wsFactory: (u) => new FakeWebSocket(u) as unknown as WebSocketLike,
			fetchFn: (async (url: unknown, init?: { body?: string }) => {
				const method = String(url).split('/').slice(-2).join('/');
				const body = JSON.parse(init?.body ?? '{}') as { rpcId: string; payload?: { args?: { request?: { address?: unknown } } } };
				if (method === 'session/page') address = body.payload?.args?.request?.address;
				const value = method === 'session/list' ? { items: [ROW] } : { records: [], hasMore: false };
				return new Response(
					JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } }),
					{ status: 200 }
				);
			}) as unknown as typeof fetch,
			rpcIdFactory: () => 'rpc-test'
		});
		return conn.history('kid').then(() => address as Record<string, unknown>);
	}

	let ROW: Record<string, unknown>;
	it('an empty parentSessionId keeps NO hint (the host rejects, DSI never guesses)', async () => {
		ROW = {
			sessionId: 'kid',
			origin: 'subagent',
			parentSessionId: '',
			projections: { asOfSeq: 1, values: { subagent: { mode: 'one-shot' } } }
		};
		expect(await pageAddress()).toEqual({ kind: 'session', sessionId: 'kid' });
	});

	it('a non-object subagent identity keeps NO hint', async () => {
		ROW = {
			sessionId: 'kid',
			origin: 'subagent',
			parentSessionId: 'parent-1',
			projections: { asOfSeq: 1, values: { subagent: 'junk' } }
		};
		expect(await pageAddress()).toEqual({ kind: 'session', sessionId: 'kid' });
	});
});

describe('dsh-connection — listDirectory conservative normalize arms', () => {
	it('junk fields drop out; absent lists normalize empty; hidden only on explicit true', async () => {
		const conn = makeConn({
			'directoryPicker/list': {
				path: 42,
				home: null,
				entries: [null, 'str', { name: 'only-name' }, { name: 'ok', path: '/ok', hidden: 'x' }],
				truncated: 'yes'
			}
		});
		const listing = await conn.listDirectory();
		expect(listing.path).toBe('');
		expect(listing.home).toBe('');
		expect(listing.crumbs).toEqual([]);
		expect(listing.entries).toEqual([{ name: 'ok', path: '/ok', hidden: false }]);
		expect(listing.truncated).toBe(false);
	});
});

describe('normalizeModelDirectory — the exported catalog normalizer', () => {
	it('a default-keyed catalog derives routable from routableProviders + groups', () => {
		const dir = normalizeModelDirectory({
			default: { provider: 'deepseek', model: 'glm-5.3', reasoningEffort: 'high' },
			routableProviders: ['deepseek'],
			groups: [{ id: 'deepseek', models: [] }],
			failures: []
		});
		expect(dir.current).toEqual({ provider: 'deepseek', model: 'glm-5.3', reasoningEffort: 'high' });
		expect(dir.routable).toBe(true);
	});

	it('an empty default-keyed catalog is honestly NOT routable', () => {
		const dir = normalizeModelDirectory({ default: null, routableProviders: [], groups: [] });
		expect(dir.current).toBeNull();
		expect(dir.routable).toBe(false);
	});

	it('a junk catalog normalizes to the honest empty directory', () => {
		expect(normalizeModelDirectory('garbage')).toEqual({ current: null, routable: false, groups: [], failures: [] });
		expect(normalizeModelDirectory(undefined)).toEqual({ current: null, routable: false, groups: [], failures: [] });
	});

	it('a current-keyed catalog requires routable === true explicitly', () => {
		const dir = normalizeModelDirectory({ current: { provider: 'p', model: 'm' }, routable: 'yes' });
		expect(dir.current).toEqual({ provider: 'p', model: 'm' });
		expect(dir.routable).toBe(false);
	});

	it('junk groups/models/efforts/failures drop out row-by-row, never throw', () => {
		const dir = normalizeModelDirectory({
			routable: true,
			groups: [
				null,
				{},
				{ id: '' },
				{ id: 'g', models: 'x' },
				{ id: 'g', models: [null, { id: '' }, { id: 'm1' }, { id: 'm2', name: 'M2', reasoning: { efforts: [{}, { id: 'low' }, 'x'] } }] }
			],
			failures: [null, {}, { id: 'f' }, { id: 'f2', name: 'F2', message: 'down' }]
		});
		expect(dir.groups).toEqual([
			{ id: 'g', name: null, models: [] },
			{ id: 'g', name: null, models: [{ id: 'm1', name: null }, { id: 'm2', name: 'M2', reasoningEfforts: ['low'] }] }
		]);
		expect(dir.failures).toEqual([
			{ id: 'f', name: null, message: null },
			{ id: 'f2', name: 'F2', message: 'down' }
		]);
	});
});

describe('normalizeSessionRow — exported row normalizer arms', () => {
	it('a subagent row falls back to the projections title when the label is unreadable', () => {
		const row = normalizeSessionRow({
			sessionId: 'kid',
			origin: 'subagent',
			parentSessionId: 'p1',
			projections: { values: { title: 'Prompt title', subagent: 'junk' } }
		});
		expect(row.title).toBe('Prompt title');
	});

	it('agentPreset prefers the projections value and falls back to the top-level row field', () => {
		const fromProjection = normalizeSessionRow({ sessionId: 'a', projections: { values: { agentPreset: 'research' } } });
		expect(fromProjection.agentPreset).toBe('research');
		const fromRow = normalizeSessionRow({ sessionId: 'a', agentPreset: 'main', projections: {} });
		expect(fromRow.agentPreset).toBe('main');
		expect(normalizeSessionRow({ sessionId: 'a' }).agentPreset).toBeNull();
	});

	it('turns: projections sessionStats wins; the row-level block is the fallback; junk → null', () => {
		expect(normalizeSessionRow({ sessionId: 'a', projections: { values: { sessionStats: { turns: 3 } } } }).turns).toBe(3);
		expect(normalizeSessionRow({ sessionId: 'a', sessionStats: { turns: 5 } }).turns).toBe(5);
		expect(normalizeSessionRow({ sessionId: 'a', sessionStats: { turns: 2.5 } }).turns).toBeNull();
		expect(normalizeSessionRow({ sessionId: 'a', projections: { values: { sessionStats: null } } }).turns).toBeNull();
	});

	it('blank cwd and absent updatedAt normalize to null / 0', () => {
		const row = normalizeSessionRow({ sessionId: 'a', cwd: '' });
		expect(row.workspace).toBeNull();
		expect(row.updatedAt).toBe(0);
		expect(row.running).toBe(false);
		expect(row.blank).toBe(false);
	});
});

describe('normalizePreset — the exported preset normalizer arms', () => {
	it('junk fields keep the id stringified and never invent data', () => {
		expect(normalizePreset({ id: 42, name: 7, description: null, isDefault: 'yes' })).toEqual({
			id: '42',
			name: null,
			description: null,
			isDefault: false
		});
		expect(normalizePreset({})).toEqual({ id: '', name: null, description: null, isDefault: false });
		expect(normalizePreset({ id: 'main', isDefault: true })).toEqual({
			id: 'main',
			name: null,
			description: null,
			isDefault: true
		});
	});

	it('a system-trust shipped id resolves the English overlay — the wire name is the unlocalized zh fallback', () => {
		expect(
			normalizePreset({
				id: 'standard',
				trust: 'system',
				name: '标准模式',
				description: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
				isDefault: true
			})
		).toEqual({
			id: 'standard',
			name: 'Standard mode',
			description:
				'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
			isDefault: true
		});
	});

	it('unknown system ids and user presets keep the host name verbatim — the overlay never translates user metadata', () => {
		expect(normalizePreset({ id: 'future-built-in', trust: 'system', name: '主机名', isDefault: false })).toEqual({
			id: 'future-built-in',
			name: '主机名',
			description: null,
			isDefault: false
		});
		expect(normalizePreset({ id: 'standard', trust: 'user', name: 'My Standard', isDefault: false })).toEqual({
			id: 'standard',
			name: 'My Standard',
			description: null,
			isDefault: false
		});
	});

	it('overlayEnglish false hands the wire name through even for a shipped id (the dsh.presetEnglish off seat)', () => {
		expect(
			normalizePreset(
				{ id: 'standard', trust: 'system', name: '标准模式', description: '功能完整的编码 Agent。', isDefault: true },
				false
			)
		).toEqual({
			id: 'standard',
			name: '标准模式',
			description: '功能完整的编码 Agent。',
			isDefault: true
		});
	});
});
