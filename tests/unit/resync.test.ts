// @vitest-environment node
/**
 * Resync resilience (task 4.2-T, paired with 4.2) — three contracts:
 *
 *   1. Gap detection: mux drop → buffer hole → eventsSince reports gap →
 *      orchestrator re-reads the LEDGER (full=1) → store replaces, no dupes.
 *   2. Resync dedupes the optimistic entry (in-flight submit survives visually
 *      only until its durable twin lands; the twin is never double-rendered).
 *   3. WS error → reconnect backoff schedule (generation rebuild pacing).
 *
 * BC-4 anchor: the ledger is the truth; the ring buffer is freshness only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DshConnection } from '$lib/server/dsh-connection';
import { createConversationStore } from '$lib/services/conversation/store.svelte';
import { createPollingOrchestrator } from '$lib/services/conversation/polling-orchestrator.svelte';
import type { DsiEntry } from '$lib/types';

// ── shared fakes (same shape as dsh-connection.test.ts) ────────────────

class FakeWebSocket {
	sent: string[] = [];
	static instances: FakeWebSocket[] = [];
	listeners = new Map<string, Array<(e?: unknown) => void>>();
	url: string;
	closed = false;
	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}
	addEventListener(ev: string, fn: (e?: unknown) => void): void {
		this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn]);
	}
	pushFrame(payload: unknown): void {
		const raw = JSON.stringify(payload);
		for (const fn of this.listeners.get('message') ?? []) fn({ data: raw });
	}
	simulateClose(): void {
		if (this.closed) return;
		this.closed = true;
		for (const fn of this.listeners.get('close') ?? []) fn();
	}
	send(data: string): void {
		this.sent.push(data);
	}
	close(): void {
		this.simulateClose();
	}
}

function muxSocket(): FakeWebSocket | undefined {
	return FakeWebSocket.instances.find((s) => s.url.endsWith('/api/remote.mux') && !s.closed);
}

/** Open + follow-frame helpers (0.1.2 remote.mux logical streams). */
function openAndFollow(conn: DshConnection, sessionId: string): void {
	conn.subscribe(sessionId);
	const socket = muxSocket();
	for (const fn of socket?.listeners.get('open') ?? []) fn();
}

function streamIdOf(sessionId: string): string | undefined {
	const socket = muxSocket();
	const sent = (socket?.sent ?? []).map((raw) => JSON.parse(raw) as { type?: string; streamId?: string });
	return sent.find((m) => m.type === 'open' && m.streamId?.startsWith(`follow-${sessionId}`))?.streamId;
}

function followSnap(sessionId: string, cursor: number): void {
	const socket = muxSocket();
	const raw = JSON.stringify({ type: 'item', streamId: streamIdOf(sessionId), value: { type: 'snapshot', cursor, records: [] } });
	for (const fn of socket?.listeners.get('message') ?? []) fn({ data: raw });
}

function followItem(sessionId: string, event: unknown): void {
	const socket = muxSocket();
	const raw = JSON.stringify({ type: 'item', streamId: streamIdOf(sessionId), value: { type: 'event', event } });
	for (const fn of socket?.listeners.get('message') ?? []) fn({ data: raw });
}

function makeConn(scripted: Record<string, unknown> = {}): DshConnection {
	const fetchFn = (async (u: unknown, init?: { body?: string }) => {
		const method = String(u).split('/').pop() ?? '';
		const body = JSON.parse(init?.body ?? '{}') as { rpcId: string };
		const result = scripted[method];
		if (result === undefined) {
			return new Response(
				JSON.stringify({
					type: 'server-response',
					rpcId: body.rpcId,
					result: { ok: false, error: { code: 'session/not-found', message: 'nope' } }
				}),
				{ status: 200 }
			);
		}
		return new Response(
			JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: result } }),
			{ status: 200 }
		);
	}) as unknown as typeof fetch;
	return new DshConnection({
		wsFactory: (u) => new FakeWebSocket(u) as unknown as import('$lib/server/dsh-connection').WebSocketLike,
		fetchFn,
		rpcIdFactory: () => 'rpc-resync-test',
		backoffScheduleMs: [10, 20, 40, 80]
	});
}

function ev(seq: number, text = `t${seq}`): { type: string; seq: number; time: number; data: Record<string, unknown> } {
	return {
		type: 'user/message',
		seq,
		time: seq * 1000,
		data: { text }
	};
}

beforeEach(() => {
	FakeWebSocket.instances = [];
});

// ── 1. gap detection → ledger resync, no dupes ─────────────────────────

describe('4.2 — gap detection triggers ledger resync', () => {
	it('eventsSince flags the gap after a mux drop loses events', () => {
		vi.useFakeTimers();
		try {
			const conn = makeConn();
			conn.ensureDownlinks();
			openAndFollow(conn, 's1');
			followSnap('s1', 0);
			followItem('s1', ev(1));
			followItem('s1', ev(2));
			// no gap yet: client at 2 is seamless
			expect(conn.eventsSince('s1', 2).gap).toBe(false);

			// mux drops; after the backoff rung the generation rebuilds and the
			// stream resumes at seq 5 — events 3 and 4 are LOST to the buffer.
			muxSocket()!.simulateClose();
			vi.advanceTimersByTime(10);
			const current = muxSocket()!;
			openAndFollow(conn, 's1');
			followSnap('s1', 2);
			followItem('s1', ev(5));

			const res = conn.eventsSince('s1', 2);
			expect(res.gap).toBe(true);
			expect(res.events.map((e) => e.seq)).toEqual([5]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('orchestrator poll with gap → resync(): store replaced from ledger, zero duplicates', async () => {
		vi.useFakeTimers();
		try {
			const store = createConversationStore('s1');
			store.replaceAll([]); // cold-loaded empty for the scenario
			store.applyStatus(false, 2);

			// fetch script: first poll → gap flag with partial entries;
			// resync fetch (full=1) → ledger page with seq 1..5
			const ledgerEntries: DsiEntry[] = [
				{ kind: 'user-message', id: 'u:1', seq: 1, time: 1001, text: 'hello' },
				{ kind: 'assistant-message', id: 'a:1:1', seq: 3, time: 1003, text: 'world', streaming: false },
				{ kind: 'assistant-message', id: 'a:1:2', seq: 5, time: 1005, text: 'again', streaming: false }
			];
			const calls: string[] = [];
			let pollCount = 0;
			const fetchFn = (async (url: unknown) => {
				const u = String(url);
				calls.push(u);
				if (u.includes('full=1')) {
					return new Response(
						JSON.stringify({
							ok: true,
							entries: ledgerEntries,
							lastSeq: 5,
							running: false
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					);
				}
				pollCount += 1;
				if (pollCount === 1) {
					// gap poll: only the post-gap fragment arrives
					return new Response(
						JSON.stringify({
							ok: true,
							entries: [{ kind: 'assistant-message', id: 'a:1:2', seq: 5, time: 1005, text: 'again', streaming: false }],
							lastSeq: 5,
							running: false,
							gap: true
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					);
				}
				return new Response(
					JSON.stringify({ ok: true, entries: [], lastSeq: 5, running: false, gap: false }),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			}) as unknown as typeof fetch;

			const orch = createPollingOrchestrator(store, {
				fetchFn,
				setTimer: (fn, ms) => setTimeout(fn, ms),
				clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>)
			});

			await orch.poll(); // first poll carries the gap

			// resync happened: the full=1 URL was fetched
			expect(calls.some((c) => c.includes('full=1'))).toBe(true);
			// store now holds the LEDGER list exactly once per entry
			const ids = store.entries.map((e) => e.id).sort();
			expect(ids).toEqual(['a:1:1', 'a:1:2', 'u:1']);
			// no duplicates by construction
			expect(new Set(store.entries.map((e) => e.id)).size).toBe(store.entries.length);
			// lastSeq advanced to the ledger tail
			expect(store.lastSeq).toBe(5);
		} finally {
			vi.useRealTimers();
		}
	});
});

// ── 2. resync dedupes the optimistic entry ─────────────────────────────

describe('4.2 — resync dedupes the optimistic entry', () => {
	it('optimistic bubble survives resync until its durable twin lands, then is consumed exactly once', () => {
		const store = createConversationStore('s1');
		store.replaceAll([]);
		store.applyStatus(false, 2);

		// user submits; optimistic bubble appears
		store.addOptimisticUserEntry('Playwright test prompt');

		// gap → resync from ledger that does NOT yet contain the twin
		store.resyncFromLedgerEntries(
			[{ kind: 'assistant-message', id: 'a:0:1', seq: 2, time: 1002, text: 'earlier', streaming: false }],
			2,
			false
		);
		const optimisticAlive = store.entries.some(
			(e) => e.kind === 'user-message' && 'local' in e && (e as { local?: boolean }).local === true
		);
		expect(optimisticAlive).toBe(true); // in-flight submit NOT visually reverted
		expect(store.entries).toHaveLength(2); // earlier + optimistic

		// later poll brings the durable twin; dedupe consumes the optimistic copy
		store.appendMany([{ kind: 'user-message', id: 'u:9', seq: 6, time: 1006, text: 'Playwright test prompt' }]);
		store.dedupeOptimistic();
		const userRows = store.entries.filter((e) => e.kind === 'user-message');
		expect(userRows).toHaveLength(1); // no double bubble
		expect(userRows[0].id).toBe('u:9'); // durable copy wins
		expect('local' in userRows[0]).toBe(false);
	});

	it('resync with the twin already in the ledger consumes the optimistic copy immediately', () => {
		const store = createConversationStore('s1');
		store.replaceAll([]);
		store.applyStatus(false, 2);
		store.addOptimisticUserEntry('Hi');
		store.resyncFromLedgerEntries(
			[
				{ kind: 'user-message', id: 'u:1', seq: 1, time: 1001, text: 'Hi' },
				{ kind: 'assistant-message', id: 'a:1:1', seq: 2, time: 1002, text: 'Hello!', streaming: false }
			],
			2,
			false
		);
		const userRows = store.entries.filter((e) => e.kind === 'user-message');
		expect(userRows).toHaveLength(1);
		expect(userRows[0].id).toBe('u:1');
	});
});

// ── 3. WS error → reconnect backoff schedule ───────────────────────────

describe('4.2 — WS error → reconnect backoff schedule', () => {
	it('error on mux tears down the generation; rebuild waits the full backoff ladder', () => {
		vi.useFakeTimers();
		try {
			const conn = makeConn();
			conn.ensureDownlinks();
			const gen1mux = muxSocket()!;

			// socket-level ERROR (not clean close) → same teardown path
			for (const fn of gen1mux.listeners.get('error') ?? []) fn();

			// generation gone immediately
			expect(muxSocket()).toBeUndefined();

			// backoff ladder [10, 20, 40, 80]: nothing at 9ms, alive at 10ms
			vi.advanceTimersByTime(9);
			expect(muxSocket()).toBeUndefined();
			vi.advanceTimersByTime(1);
			expect(muxSocket()).toBeDefined();

			// second drop → next rung is 20ms
			const gen2mux = muxSocket()!;
			for (const fn of gen2mux.listeners.get('error') ?? []) fn();
			vi.advanceTimersByTime(19);
			expect(muxSocket()).toBeUndefined();
			vi.advanceTimersByTime(1);
			expect(muxSocket()).toBeDefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('a healthy generation after backoff serves deltas seamlessly (gap=false)', () => {
		const conn = makeConn();
		conn.ensureDownlinks();
		openAndFollow(conn, 's1');
			followSnap('s1', 0);
		followItem('s1', ev(1));
		followItem('s1', ev(2));
		followItem('s1', ev(3));
		const res = conn.eventsSince('s1', 1);
		expect(res.gap).toBe(false);
		expect(res.events.map((e) => e.seq)).toEqual([2, 3]);
	});
});
