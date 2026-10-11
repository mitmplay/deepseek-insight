
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DshConnection, resetDshConnectionForTests } from '$lib/server/dsh-connection';

// Hermetic config — same contract as dsh-connection.test.ts.
const configDir = mkdtempSync(join(tmpdir(), 'dsi-conn-gaps-'));
const configPath = join(configDir, 'settings.yaml');
beforeAll(() => {
	process.env.DSI_CONFIG_PATH = configPath;
	writeFileSync(
		configPath,
		'server:\n  port: 3080\n  ringCapacity: 50\ndsh:\n  baseUrl: http://127.0.0.1:3080\n'
	);
});
afterAll(() => {
	delete process.env.DSI_CONFIG_PATH;
	rmSync(configDir, { recursive: true, force: true });
});

/** Fake auth: no cookie minting, no config reads. */
function fakeAuth(cookie: string | null = null) {
	return {
		ensureCookie: vi.fn(async () => cookie),
		invalidate: vi.fn()
	};
}

/** Connection with rpc() stubbed to a recorder — the delegates under test
 *  are thin pass-throughs; the recorder pins method + payload. */
function makeStubbedConn(responses: Array<{ status: number; body?: unknown }> = []) {
	let call = 0;
	const fetchFn = (async () => {
		const r = responses[Math.min(call, responses.length - 1)] ?? { status: 200, body: {} };
		call++;
		return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
	}) as unknown as typeof fetch;
	const conn = new DshConnection({ fetchFn, auth: fakeAuth('tok') as never });
	const rpcCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
	(conn as unknown as { rpc: unknown }).rpc = async (
		method: string,
		payload: Record<string, unknown>
	) => {
		rpcCalls.push({ method, payload });
		return { ok: true };
	};
	return { conn, rpcCalls };
}

beforeEach(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	resetDshConnectionForTests();
});

describe('dsh-connection — onMuxFrame dispatch (registry arms)', () => {
	it('registers approval/requested with sessionId + rpcId; ignores orphans', () => {
		const { conn } = makeStubbedConn();
		const onMuxFrame = (conn as unknown as { onMuxFrame: (p: unknown, id?: string) => void }).onMuxFrame;
		// good frame
		onMuxFrame.call(conn, { type: 'approval/requested', sessionId: 's1', approvalId: 'a1' }, 'rpc-1');
		expect(conn.pendingFor('s1')).toHaveLength(1);
		expect(conn.pendingFor('s1')[0].kind).toBe('approval');
		// orphan: no sessionId → ignored
		onMuxFrame.call(conn, { type: 'approval/requested', approvalId: 'a2' }, 'rpc-2');
		expect(conn.pendingFor('s1')).toHaveLength(1);
		// missing rpcId → ignored
		onMuxFrame.call(conn, { type: 'question/requested', sessionId: 's1' });
		expect(conn.pendingFor('s1')).toHaveLength(1);
		// question kind
		onMuxFrame.call(conn, { type: 'question/requested', sessionId: 's2', questionRpcId: 'q1' }, 'rpc-3');
		expect(conn.pendingFor('s2')[0].kind).toBe('question');
		// non-string sessionId → orphan arm too
		onMuxFrame.call(conn, { type: 'approval/requested', sessionId: 42 }, 'rpc-4');
		expect(conn.pendingFor('s1')).toHaveLength(1);
	});

	it('registers settlements: approval by approvalId, question by questionRpcId, unknown ignored', () => {
		const { conn } = makeStubbedConn();
		const onMuxFrame = (conn as unknown as { onMuxFrame: (p: unknown, id?: string) => void }).onMuxFrame;
		onMuxFrame.call(conn, { type: 'approval/requested', sessionId: 's1', approvalId: 'a1' }, 'rpc-1');
		// approval/resolved matching the pending body's approvalId
		onMuxFrame.call(conn, { type: 'approval/resolved', sessionId: 's1', approvalId: 'a1', outcome: 'allow' });
		expect(conn.pendingFor('s1')).toHaveLength(0);
		expect(conn.settlementsFor('s1')).toHaveLength(1);
		expect(conn.settlementsFor('s1')[0]).toMatchObject({ rpcId: 'rpc-1', outcome: 'allow', kind: 'approval' });
		// approval/resolved with no matching pending → ignored (else arm)
		onMuxFrame.call(conn, { type: 'approval/resolved', sessionId: 's1', approvalId: 'ghost', outcome: 'deny' });
		expect(conn.settlementsFor('s1')).toHaveLength(1);
		// question/resolved keyed by questionRpcId
		onMuxFrame.call(conn, { type: 'question/resolved', sessionId: 's2', questionRpcId: 'q9', outcome: 'answered' });
		expect(conn.settlementsFor('s2')).toHaveLength(1);
		expect(conn.settlementsFor('s2')[0]).toMatchObject({ rpcId: 'q9', outcome: 'answered', kind: 'question' });
		// non-string outcome → 'unknown'
		onMuxFrame.call(conn, { type: 'question/resolved', sessionId: 's3', questionRpcId: 'q10', outcome: 7 });
		expect(conn.settlementsFor('s3')[0].outcome).toBe('unknown');
		// settlement without sessionId → early return
		onMuxFrame.call(conn, { type: 'approval/resolved', approvalId: 'a1' });
		expect(conn.settlementsFor('')).toHaveLength(0);
	});

	it('session/subscribed + session/event arms seed and append; unknown types are ignored', () => {
		const { conn } = makeStubbedConn();
		const onMuxFrame = (conn as unknown as { onMuxFrame: (p: unknown, id?: string) => void }).onMuxFrame;
		onMuxFrame.call(conn, { type: 'session/subscribed', sessionId: 's1', lastSeq: 7 });
		expect(conn.hasBaseline('s1')).toBe(true);
		expect(conn.eventsSince('s1', 0).lastSeq).toBe(7);
		// subscribed without sessionId → skipped
		onMuxFrame.call(conn, { type: 'session/subscribed' });
		// subscribed without lastSeq → ?? -1 arm
		onMuxFrame.call(conn, { type: 'session/subscribed', sessionId: 's2' });
		expect(conn.eventsSince('s2', 0).lastSeq).toBe(-1);
		// session/event with event → appended
		onMuxFrame.call(conn, { type: 'session/event', sessionId: 's1', event: { type: 'x', seq: 8, time: 1 } });
		expect(conn.eventsSince('s1', 7).events).toHaveLength(1);
		// session/event without event → skipped
		onMuxFrame.call(conn, { type: 'session/event', sessionId: 's1' });
		// default arm — ignored, no throw
		expect(() => onMuxFrame.call(conn, { type: 'queue/jobs' })).not.toThrow();
	});
});

describe('dsh-connection — RPC pass-through delegates', () => {
	it('workspaceOwnerSessionId + addressFor pass through to the relay', async () => {
		const { conn } = makeStubbedConn();
		(conn as unknown as { rpc: unknown }).rpc = async () => ({
			items: [
				{ sessionId: 'child', title: 'c', parentSessionId: 'root', origin: 'subagent', projections: { asOfSeq: 1, values: { subagent: { mode: 'one-shot' } } } },
				{ sessionId: 'root', title: 'r', parentSessionId: null }
			]
		});
		await expect(conn.workspaceOwnerSessionId('child')).resolves.toBe('root');
		await expect(conn.workspaceOwnerSessionId('root')).resolves.toBe('root');
		expect(conn.addressFor('root')).toEqual({ kind: 'session', sessionId: 'root' });
		// subagent hint folded from the list → subagent address form
		expect(conn.addressFor('child')).toMatchObject({
			kind: 'subagent',
			parentSessionId: 'root',
			childSessionId: 'child',
			mode: 'one-shot'
		});
	});

	it('workspaceOwnerSessionId survives a parent cycle', async () => {
		const { conn } = makeStubbedConn();
		(conn as unknown as { rpc: unknown }).rpc = async () => ({
			items: [
				{ sessionId: 'a', title: 'a', parentSessionId: 'b' },
				{ sessionId: 'b', title: 'b', parentSessionId: 'a' }
			]
		});
		await expect(conn.workspaceOwnerSessionId('a')).resolves.toBe('a');
	});

	it('workspace file delegates pass method + args verbatim', async () => {
		const { conn, rpcCalls } = makeStubbedConn();
		await conn.readWorkspaceFile('s1', 'a.txt', { offset: 1, limit: 2 });
		await conn.readWorkspaceFileBytes('s1', 'b.bin', { offset: 0, length: 16 });
		await conn.listWorkspaceDirectory('s1', 'sub');
		const methods = rpcCalls.map((c) => c.method);
		expect(methods).toHaveLength(3);
		expect(methods[0]).toBe('workspaceFiles/read');
		expect(methods[1]).toBe('workspaceFiles/readBytes');
		expect(methods[2]).toBe('workspaceFiles/list');
	});

	it('forkSession omits an undefined atSeq, sends a defined one', async () => {
		const { conn, rpcCalls } = makeStubbedConn();
		await conn.forkSession('s1');
		await conn.forkSession('s1', 12);
		expect(rpcCalls[0].payload.request.atSeq).toBeUndefined();
		expect(rpcCalls[1].payload.request.atSeq).toBe(12);
	});

	it('fetchHostPath re-mints once on 401 then returns the response', async () => {
		const conn = new DshConnection({
			fetchFn: (async () => new Response('ok', { status: 401 })) as unknown as typeof fetch,
			auth: fakeAuth('tok') as never
		});
		const res = await conn.fetchHostPath('/api/x');
		expect(res.status).toBe(401);
		expect((conn.auth as unknown as { invalidate: ReturnType<typeof vi.fn> }).invalidate).toHaveBeenCalledTimes(1);
	});

	it('fetchHostPath sends no cookie header when auth has none', async () => {
		let seenInit: RequestInit | undefined;
		const conn = new DshConnection({
			fetchFn: (async (_url: unknown, init?: RequestInit) => {
				seenInit = init;
				return new Response('ok', { status: 200 });
			}) as unknown as typeof fetch,
			auth: fakeAuth(null) as never
		});
		const res = await conn.fetchHostPath('/api/x');
		expect(res.status).toBe(200);
		expect((seenInit?.headers as Record<string, string>).cookie).toBeUndefined();
	});

	it('the default wsFactory mints a real WebSocket', () => {
		const conn = new DshConnection({ auth: fakeAuth() as never });
		const ws = conn.wsFactory('ws://127.0.0.1:1/unreachable') as unknown as {
			addEventListener: unknown;
			close: () => void;
		};
		expect(typeof ws.addEventListener).toBe('function');
		ws.close();
	});
});

describe('dsh-connection — respond value normalization + resync floor', () => {
	it('respond unwraps legacy outcome/answer/answers payloads and the bare rest', async () => {
		const { conn, rpcCalls } = makeStubbedConn();
		(conn.downlinks as unknown as { eventClientId: string | null }).eventClientId = 'client-1';
		await conn.respond('rpc-1', { sessionId: 's1', outcome: 'allow' });
		await conn.respond('rpc-2', { sessionId: 's1', answer: { answers: [1] } });
		await conn.respond('rpc-3', { sessionId: 's1', answers: [2] });
		await conn.respond('rpc-4', { sessionId: 's1', custom: 'x' });
		const values = rpcCalls.map((c) => (c.payload.outcome as { value: unknown }).value);
		expect(values).toEqual(['allow', { answers: [1] }, { answers: [2] }, { custom: 'x' }]);
	});

	it('respond throws before any wire call when no $events generation exists', async () => {
		const { conn, rpcCalls } = makeStubbedConn();
		await expect(conn.respond('rpc-1', { outcome: 'allow' })).rejects.toThrow(
			/no \$events generation/
		);
		expect(rpcCalls).toHaveLength(0);
	});

	it('resyncFromLedger with an empty page floors coverage at lastSeq', async () => {
		const { conn } = makeStubbedConn();
		(conn as unknown as { rpc: unknown }).rpc = async () => ({ records: [], hasMore: false });
		const events = await conn.resyncFromLedger('sx');
		expect(events).toEqual([]);
		const buf = (conn as unknown as { sessions: { bufferFor: (id: string) => { lastSeq: number; coverageFloor: number } } }).sessions.bufferFor('sx');
		expect(buf.lastSeq).toBe(-1);
		expect(buf.coverageFloor).toBe(-1);
	});

	it('pageAsHistory normalizes garbage, hasMore and a projections block', () => {
		const { conn } = makeStubbedConn();
		const pageAsHistory = (conn.relay as unknown as { pageAsHistory: (raw: unknown) => unknown }).pageAsHistory;
		const empty = pageAsHistory.call(conn.relay, {}) as { events: unknown[]; hasMore: boolean };
		expect(empty.events).toEqual([]);
		expect(empty.hasMore).toBe(false);
		const projections = { asOfSeq: 4, values: {} };
		const full = pageAsHistory.call(conn.relay, {
			records: [{ type: 'assistant/message', event: { type: 'assistant/message', seq: 1, time: 1 } }],
			hasMore: true,
			projections
		}) as { events: unknown[]; hasMore: boolean; projections: unknown };
		expect(full.hasMore).toBe(true);
		expect(full.events).toHaveLength(1);
		expect(full.projections).toBe(projections);
		const nonArray = pageAsHistory.call(conn.relay, { records: 'garbage' }) as { events: unknown[] };
		expect(nonArray.events).toEqual([]);
	});
});
