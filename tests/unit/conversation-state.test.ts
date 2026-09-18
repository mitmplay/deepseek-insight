/**
 * conversation-state unit tests (paired with task 3.2).
 *
 * Store: replace/append semantics, optimistic entry + dedupe on event
 * arrival, status flips. Orchestrator: adaptive interval switch on running
 * flip (500/2000, BC-7), single active client, stop() clears timers,
 * submit returns on the receipt only (BC-3), rejection → banner + unlock.
 *
 * Runes modules compile via the svelte plugin (vitest.config conditions:
 * browser) — no DOM needed for the state machine, but happy-dom is the
 * default environment and harmless here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationStore } from '$lib/services/conversation/store.svelte';
import { createPollingOrchestrator, POLL_IDLE_MS, POLL_RUNNING_MS } from '$lib/services/conversation/polling-orchestrator.svelte';
import type { DsiEntry } from '$lib/types';

function userEntry(text: string): DsiEntry {
	// Wave-1 lockstep: DsiEntry.time (wire event.time) is required — fixture extended.
	return { kind: 'user-message', id: `u:${text}`, seq: 10, time: 1000, text };
}

function assistantFragment(seq: number, text: string): DsiEntry {
	return { kind: 'assistant-message', id: 'a:1:1', seq, time: 1000 + seq, text, streaming: true };
}

describe('conversation store — prependOlder (W3 load-older)', () => {
	it('prepends a disjoint older page before the current entries', () => {
		const store = createConversationStore('s1');
		store.replaceAll([userEntry('newer')]);
		const older: DsiEntry[] = [
			{ kind: 'user-message', id: 'u:old1', seq: 3, time: 900, text: 'old1' },
			{ kind: 'user-message', id: 'u:old2', seq: 5, time: 950, text: 'old2' }
		];
		const added = store.prependOlder(older);
		expect(added).toBe(true);
		expect(store.entries.map((e) => (e as { text: string }).text)).toEqual(['old1', 'old2', 'newer']);
	});

	it('dedupes a page that overlaps the buffer (same ids/seqs land once)', () => {
		const store = createConversationStore('s1');
		store.replaceAll([userEntry('tail')]); // id u:tail, seq 10
		const overlap: DsiEntry[] = [
			{ kind: 'user-message', id: 'u:old', seq: 4, time: 800, text: 'old' },
			{ kind: 'user-message', id: 'u:tail', seq: 10, time: 1000, text: 'tail' } // already on screen
		];
		const added = store.prependOlder(overlap);
		expect(added).toBe(true);
		expect(store.entries.map((e) => (e as { text: string }).text)).toEqual(['old', 'tail']);
	});

	it('returns false and keeps the list intact when the page is fully known', () => {
		const store = createConversationStore('s1');
		store.replaceAll([userEntry('only')]);
		const again: DsiEntry[] = [userEntry('only')];
		expect(store.prependOlder(again)).toBe(false);
		expect(store.entries).toHaveLength(1);
	});

	it('returns false on an empty page (ledger head reached)', () => {
		const store = createConversationStore('s1');
		store.replaceAll([userEntry('only')]);
		expect(store.prependOlder([])).toBe(false);
		expect(store.entries).toHaveLength(1);
	});
});

describe('conversation store', () => {
	it('replaceAll replaces the whole list (cold load)', () => {
		const store = createConversationStore('s1');
		store.replaceAll([userEntry('Hi')]);
		expect(store.entries).toHaveLength(1);
		store.replaceAll([userEntry('Hello'), assistantFragment(11, 'Welcome!')]);
		expect(store.entries.map((e) => e.kind)).toEqual(['user-message', 'assistant-message']);
	});

	it('applyLiveStream replaces the bubble wholesale, is re-poll idempotent, and a null tail clears it', () => {
		const store = createConversationStore('s1');
		// Ledger v2: the live tail carries the FULL accumulation each poll —
		// replace, never concat (the pre-v2 chunk fragments concatenated here).
		store.applyLiveStream({ id: 'a:1:1', turn: 1, step: 1, seq: 10, time: 1001, text: 'Hi', reasoning: '' });
		store.applyLiveStream({ id: 'a:1:1', turn: 1, step: 1, seq: 10, time: 1002, text: 'Hi there', reasoning: '' });
		store.applyLiveStream({ id: 'a:1:1', turn: 1, step: 1, seq: 10, time: 1002, text: 'Hi there', reasoning: '' });
		expect(store.entries).toHaveLength(1);
		expect(store.entries[0]).toMatchObject({ text: 'Hi there', streaming: true, time: 1002 });
		// The attempt settled without a message: the poll's null tail drops
		// the still-streaming bubble (no forever-streaming ghost).
		store.applyLiveStream(null);
		expect(store.entries).toHaveLength(0);
	});

	it('applyStatus flips running and advances lastSeq monotonically', () => {
		const store = createConversationStore('s1');
		expect(store.running).toBe(false);
		store.applyStatus(true, 42);
		expect(store.running).toBe(true);
		expect(store.isStreaming).toBe(true);
		store.applyStatus(false, 30); // older seq never regresses lastSeq
		expect(store.running).toBe(false);
		expect(store.lastSeq).toBe(42);
	});

	it('optimistic user entry renders immediately and dedupes when the real event arrives', () => {
		const store = createConversationStore('s1');
		store.addOptimisticUserEntry('Hi');
		expect(store.entries).toHaveLength(1);
		expect(store.entries[0]).toMatchObject({ kind: 'user-message', text: 'Hi' });

		// real event arrives via poll with the same text
		store.applyPoll({ entries: [userEntry('Hi')], lastSeq: 10, running: false });
		const userTexts = store.entries.filter((e) => e.kind === 'user-message').map((e) => (e as { text: string }).text);
		expect(userTexts).toEqual(['Hi']); // one copy — the durable one
	});

	it('applyPoll chains merge + status + dedupe in one call', () => {
		const store = createConversationStore('s1');
		store.addOptimisticUserEntry('ping');
		store.applyPoll({ entries: [userEntry('ping'), assistantFragment(11, 'pong')], lastSeq: 11, running: true });
		expect(store.entries.map((e) => e.kind)).toEqual(['user-message', 'assistant-message']);
		expect(store.running).toBe(true);
		expect(store.lastSeq).toBe(11);
	});

	it('applyPoll carries the projections: planMode + todos + imageLimits seed from the delta', () => {
		const store = createConversationStore('s1');
		store.applyPoll({
			entries: [],
			lastSeq: 3,
			running: false,
			plan: { active: true, pending: false },
			todos: [{ content: 'load folders', status: 'in_progress' }],
			imageLimits: null
		});
		expect(store.planMode).toEqual({ active: true, pending: false });
		expect(store.todos).toEqual([{ content: 'load folders', status: 'in_progress' }]);
		// Absent keys keep current; seedPlanMode(null) clears (resync path).
		store.applyPoll({ entries: [], lastSeq: 4, running: false, plan: { active: false, pending: false } });
		expect(store.planMode).toEqual({ active: false, pending: false });
		store.seedPlanMode(null);
		expect(store.planMode).toBeNull();
	});

	it('distinct optimistic texts survive until their own event arrives', () => {
		const store = createConversationStore('s1');
		store.addOptimisticUserEntry('one');
		store.addOptimisticUserEntry('two');
		expect(store.entries).toHaveLength(2);
		store.applyPoll({ entries: [userEntry('one')], lastSeq: 5, running: false });
		const texts = store.entries.filter((e) => e.kind === 'user-message').map((e) => (e as { text: string }).text);
		expect(texts).toEqual(['one', 'two']);
	});
});

describe('polling orchestrator', () => {
	/** Manual timer queue — records scheduled delays and fires them on demand. */
	class FakeClock {
		tasks: Array<{ fn: () => void; ms: number }> = [];
		schedule(fn: () => void, ms: number) {
			this.tasks.push({ fn, ms });
			return this.tasks.length - 1;
		}
		clear(handle: unknown) {
			if (typeof handle === 'number') this.tasks[handle] = undefined as never;
		}
		async fire(): Promise<void> {
			const t = this.tasks.filter(Boolean).pop();
			if (!t) return;
			t.fn();
			// flush the full poll chain (fetch await + res.json() await + scheduling)
			for (let i = 0; i < 8; i++) await Promise.resolve();
		}
	}

	/** Scripted transport: each GET pops one PollResponse. */
	function fakeFetch(script: Array<Record<string, unknown>>): { fetch: typeof fetch; calls: string[] } {
		const calls: string[] = [];
		const impl = (async (url: string | URL | Request, init?: RequestInit) => {
			const href = String(url);
			if (href.includes('/prompt') && init?.method === 'POST') {
				calls.push(href);
				return new Response(JSON.stringify({ ok: true, accepted: true }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (href.includes('/cancel')) {
				calls.push(href);
				return new Response(JSON.stringify({ ok: true, accepted: true }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			calls.push(href);
			const next = script.shift() ?? { ok: true, entries: [], lastSeq: 0, running: false };
			return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
		}) as typeof fetch;
		return { fetch: impl, calls };
	}

	it('polls at 500ms while running and 2000ms while idle (BC-7)', async () => {
		const store = createConversationStore('s1');
		const clock = new FakeClock();
		const { fetch } = fakeFetch([
			{ ok: true, entries: [], lastSeq: 10, running: true }, // first poll: running
			{ ok: true, entries: [], lastSeq: 10, running: true },
			{ ok: true, entries: [], lastSeq: 11, running: false } // flip to idle
		]);
		const orch = createPollingOrchestrator(store, { fetchFn: fetch, setTimer: (fn, ms) => clock.schedule(fn, ms), clearTimer: (t) => clock.clear(t) });

		await orch.start(); // immediate first poll
		expect(store.running).toBe(true);

		await clock.fire(); // poll 2 — still running
		expect(clock.tasks.filter(Boolean).at(-1)?.ms).toBe(POLL_RUNNING_MS);

		await clock.fire(); // poll 3 — flips idle
		expect(store.running).toBe(false);
		expect(clock.tasks.filter(Boolean).at(-1)?.ms).toBe(POLL_IDLE_MS);
	});

	it('isStreaming true from first poll when the turn is already running (no fake idle)', async () => {
		const store = createConversationStore('s1');
		const { fetch } = fakeFetch([{ ok: true, entries: [], lastSeq: 3, running: true }]);
		const orch = createPollingOrchestrator(store, { fetchFn: fetch, setTimer: () => 0, clearTimer: () => {} });
		await orch.start();
		expect(store.isStreaming).toBe(true);
	});

	it('stop() clears timers and halts the loop (no stray polls)', async () => {
		const store = createConversationStore('s1');
		const clock = new FakeClock();
		const { fetch, calls } = fakeFetch([{ ok: true, entries: [], lastSeq: 0, running: false }]);
		const orch = createPollingOrchestrator(store, { fetchFn: fetch, setTimer: (fn, ms) => clock.schedule(fn, ms), clearTimer: (t) => clock.clear(t) });
		await orch.start();
		orch.stop();
		expect(clock.tasks.filter(Boolean)).toHaveLength(0); // nothing scheduled after stop
		const before = calls.length;
		await clock.fire(); // no scheduled task → no fetch
		expect(calls.length).toBe(before);
	});

	it('submit() returns on the receipt only (BC-3): optimistic bubble, fast cadence, no awaited answer', async () => {
		const store = createConversationStore('s1');
		const clock = new FakeClock();
		let pollCount = 0;
		const impl = (async (url: string | URL | Request, init?: RequestInit) => {
			const href = String(url);
			if (href.includes('/prompt')) {
				// The answer NEVER rides the POST (BC-3): receipt only.
				return new Response(JSON.stringify({ ok: true, accepted: true }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			pollCount += 1;
			const running = pollCount <= 2;
			return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: pollCount, running }), { status: 200, headers: { 'content-type': 'application/json' } });
		}) as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: (fn, ms) => clock.schedule(fn, ms), clearTimer: (t) => clock.clear(t) });
		await orch.start();

		const accepted = await orch.submit('Hi');
		expect(accepted).toBe(true);
		// Optimistic bubble is present right after the receipt…
		expect(store.entries.some((e) => e.kind === 'user-message' && e.text === 'Hi')).toBe(true);

		await clock.fire(); // next poll still running → cadence stays fast
		expect(clock.tasks.filter(Boolean).at(-1)?.ms).toBe(POLL_RUNNING_MS);
	});

	it('prompt rejection (session/agent-busy) → banner set, optimistic bubble removed, submit returns false', async () => {
		const store = createConversationStore('s1');
		const clock = new FakeClock();
		const impl = (async (url: string | URL | Request, init?: RequestInit) => {
			const href = String(url);
			if (href.includes('/prompt')) {
				return new Response(
					JSON.stringify({ ok: false, error: { code: 'session/agent-busy', message: 'DSH RPC session/agent-busy: turn already in flight' } }),
					{ status: 502, headers: { 'content-type': 'application/json' } }
				);
			}
			return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: 0, running: true }), { status: 200, headers: { 'content-type': 'application/json' } });
		}) as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: (fn, ms) => clock.schedule(fn, ms), clearTimer: (t) => clock.clear(t) });
		await orch.start();

		const accepted = await orch.submit('Hi');
		expect(accepted).toBe(false);
		expect(store.error?.message).toContain('agent-busy');
		expect(store.error?.code).toBe('session/agent-busy'); // wire code rides along (2026-08-26)
		expect(store.entries.some((e) => e.kind === 'user-message' && e.text === 'Hi')).toBe(false);
	});

	it('cancel() POSTs the cancel endpoint', async () => {
		const store = createConversationStore('s1');
		const posted: string[] = [];
		const impl = (async (url: string | URL | Request, init?: RequestInit) => {
			const href = String(url);
			if (href.includes('/cancel')) {
				posted.push(href);
				return new Response(JSON.stringify({ ok: true, accepted: true }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: 0, running: false }), { status: 200, headers: { 'content-type': 'application/json' } });
		}) as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });
		await orch.start();
		const ok = await orch.cancel();
		expect(ok).toBe(true);
		expect(posted).toHaveLength(1);
		expect(posted[0]).toContain('/api/dsh/session/s1/cancel');
	});

	it('transport failure sets the error banner without crashing the loop', async () => {
		const store = createConversationStore('s1');
		const clock = new FakeClock();
		const impl = (async () => {
			throw new Error('ECONNREFUSED');
		}) as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: (fn, ms) => clock.schedule(fn, ms), clearTimer: (t) => clock.clear(t) });
		await orch.start();
		expect(store.error?.message).toContain('ECONNREFUSED');
		expect(clock.tasks.filter(Boolean)).toHaveLength(1); // rescheduled despite failure — resilience
	});
});

// ── POC-3 W2 (task 2.3-T): answerer store state + orchestrator respond ──

function pendingApproval(rpcId: string, receivedAt = 1000) {
	return {
		rpcId,
		sessionId: 's1',
		kind: 'approval' as const,
		body: { approvalId: `apr-${rpcId}`, toolName: 'Write', reason: 'writes a file' },
		receivedAt
	};
}

function settlement(rpcId: string, outcome: string, kind: 'approval' | 'question' = 'approval') {
	return { rpcId, sessionId: 's1', kind, outcome, settledAt: 2000 };
}

describe('conversation store — answerer state (task 2.3-T)', () => {
	it('applyPoll replaces pending answers BY RPCID — replay of the same rpcId never duplicates (BC-C client twin)', () => {
		const store = createConversationStore('s1');
		store.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r1')] });
		store.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r1'), pendingApproval('r2')] });
		const list = store.answerList;
		expect(list).toHaveLength(2);
		expect(list.filter((a) => a.rpcId === 'r1')).toHaveLength(1);
		expect(list.every((a) => a.phase === 'waiting')).toBe(true);
	});

	it('settlement moves its rpcId terminal; cancelled → withdrawn; acked re-delivery is inert', () => {
		const store = createConversationStore('s1');
		store.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r1'), pendingApproval('r2')] });
		store.applyPoll({ entries: [], lastSeq: 0, running: false, settledAnswers: [settlement('r1', 'allowed-once'), settlement('r2', 'cancelled')] });
		const byId = Object.fromEntries(store.answerList.map((a) => [a.rpcId, a]));
		// r1 was waiting (not our claim) → answered-elsewhere; r2 cancelled → withdrawn
		expect(byId.r1.phase).toBe('answered-elsewhere');
		expect(byId.r1.outcome).toBe('allowed-once');
		expect(byId.r2.phase).toBe('withdrawn');
		// Re-delivered settlement (at-least-once) changes nothing
		store.applyPoll({ entries: [], lastSeq: 0, running: false, settledAnswers: [settlement('r1', 'allowed-once')] });
		expect(Object.fromEntries(store.answerList.map((a) => [a.rpcId, a])).r1.phase).toBe('answered-elsewhere');
		// Stale pending replay cannot resurrect a terminal card
		store.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r2')] });
		expect(Object.fromEntries(store.answerList.map((a) => [a.rpcId, a])).r2.phase).toBe('withdrawn');
	});

	it('in-flight lock: lock once, second lock refused, release restores answerable, not-pending settles elsewhere', () => {
		const store = createConversationStore('s1');
		store.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r1')] });
		expect(store.lockAnswer('r1')).toBe(true);
		expect(store.lockAnswer('r1')).toBe(false); // double-submit guard
		expect(store.answerList[0]?.phase).toBe('in-flight');
		store.releaseAnswer('r1'); // 503 path — card stays answerable
		expect(store.answerList[0]?.phase).toBe('waiting');
		expect(store.lockAnswer('r1')).toBe(true);
		store.markAnswerElsewhere('r1', 'not-pending'); // BC-B receipt arm
		expect(store.answerList[0]?.phase).toBe('answered-elsewhere');
	});

	it('our own in-flight answer settles as settled (not elsewhere) when the broadcast lands', () => {
		const store = createConversationStore('s1');
		store.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r1')] });
		store.lockAnswer('r1');
		store.applyPoll({ entries: [], lastSeq: 0, running: false, settledAnswers: [settlement('r1', 'allowed-once')] });
		expect(store.answerList[0]?.phase).toBe('settled');
		expect(store.answerList[0]?.outcome).toBe('allowed-once');
	});

	it('ackedAnswerIds feeds the poll ack param (delivered-then-pruned ring)', () => {
		const store = createConversationStore('s1');
		store.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r1')] });
		expect(store.ackedAnswerIds()).toEqual([]);
		store.applyPoll({ entries: [], lastSeq: 0, running: false, settledAnswers: [settlement('r1', 'rejected')] });
		expect(store.ackedAnswerIds()).toEqual(['r1']);
	});

	it('renderEntries suppresses PAIRED tool-results; orphans still render (honest); entries stay untouched (BC-E)', () => {
		const store = createConversationStore('s1');
		store.replaceAll([
			userEntry('go'),
			{ kind: 'tool-call', id: 'tc:c1', seq: 11, time: 1011, callId: 'c1', toolName: 'grep', status: 'pending' },
			{ kind: 'tool-result', id: 'tr:c1', seq: 12, time: 1012, callId: 'c1', toolName: 'grep', ok: true },
			{ kind: 'tool-result', id: 'tr:c9', seq: 13, time: 1013, callId: 'c9', toolName: '', ok: false } // orphan — no call
		]);
		expect(store.entries).toHaveLength(4); // ledger truth untouched
		const kinds = store.renderEntries.map((e) => e.kind);
		expect(kinds).toEqual(['user-message', 'tool-call', 'tool-result']); // paired tr:c1 gone, orphan tr:c9 stays
	});

	it('resyncFromLedgerEntries applies answerer state — pending renders, same-payload settlement settles (2026-08-31 resync-drop fix)', () => {
		const store = createConversationStore('s1');
		store.resyncFromLedgerEntries([userEntry('tail')], 10, false, undefined, {
			pendingAnswers: [pendingApproval('r1'), pendingApproval('r2')],
			settledAnswers: [settlement('r1', 'allowed-once')]
		});
		const byId = Object.fromEntries(store.answerList.map((a) => [a.rpcId, a]));
		expect(byId.r1.phase).toBe('answered-elsewhere'); // settled in the same payload, not our claim
		expect(byId.r1.outcome).toBe('allowed-once');
		expect(byId.r2.phase).toBe('waiting'); // still answerable
	});
});

describe('polling orchestrator — respond carrier (task 2.3-T)', () => {
	function respondFetch(script: { status: number; body: unknown } | 'throw'): { fetch: typeof fetch; urls: string[]; bodies: string[] } {
		const urls: string[] = [];
		const bodies: string[] = [];
		const impl = (async (url: string | URL | Request, init?: RequestInit) => {
			const href = String(url);
			urls.push(href);
			if (href.includes('/respond')) {
				bodies.push(String(init?.body ?? ''));
				if (script === 'throw') throw new Error('ECONNREFUSED');
				return new Response(JSON.stringify(script.body), { status: script.status, headers: { 'content-type': 'application/json' } });
			}
			return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: 0, running: false }), { status: 200 });
		}) as typeof fetch;
		return { fetch: impl, urls, bodies };
	}

	it('respond POSTs {rpcId,payload}; accepted:true keeps the card in-flight until the settlement poll', async () => {
		const store = createConversationStore('s1');
		store.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r1')] });
		const { fetch, urls, bodies } = respondFetch({ status: 200, body: { ok: true, accepted: true } });
		const orch = createPollingOrchestrator(store, { fetchFn: fetch, setTimer: () => 0, clearTimer: () => {} });
		const out = await orch.respond('r1', { approvalId: 'apr-r1', outcome: 'allowed-once' });
		expect(out).toEqual({ ok: true, accepted: true });
		expect(urls[0]).toContain('/api/dsh/session/s1/respond');
		expect(JSON.parse(bodies[0])).toEqual({ rpcId: 'r1', payload: { approvalId: 'apr-r1', outcome: 'allowed-once' } });
		// W4 (spec 20) behavior change, tests-changed-with-behavior: the receipt
		// IS the host's word — accepted:true settles OUR card now (the resolved
		// broadcast can be missed entirely when the mux is down mid-answer; the
		// old wait-for-poll rule left the card stuck in-flight). The poll
		// settlement stays idempotent-confirming.
		expect(store.answerList[0]?.phase).toBe('settled'); // receipt = host confirmation
	});

	it('receipt not-pending (HTTP 200, accepted:false) settles answered-elsewhere — never an error state (BC-B)', async () => {
		const store = createConversationStore('s1');
		store.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r1')] });
		const { fetch } = respondFetch({ status: 200, body: { ok: true, accepted: false, reason: 'not-pending' } });
		const orch = createPollingOrchestrator(store, { fetchFn: fetch, setTimer: () => 0, clearTimer: () => {} });
		const out = await orch.respond('r1', { approvalId: 'apr-r1', outcome: 'rejected' });
		expect(out.accepted).toBe(false);
		expect(out.reason).toBe('not-pending');
		expect(store.answerList[0]?.phase).toBe('answered-elsewhere');
	});

	it('transport failure (503/throw) releases the lock — the card stays answerable', async () => {
		const store = createConversationStore('s1');
		store.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r1')] });
		const { fetch } = respondFetch({ status: 503, body: { ok: false, error: { code: 'host-unreachable', message: 'x' } } });
		const orch = createPollingOrchestrator(store, { fetchFn: fetch, setTimer: () => 0, clearTimer: () => {} });
		await orch.respond('r1', { approvalId: 'apr-r1', outcome: 'allowed-once' });
		expect(store.answerList[0]?.phase).toBe('waiting'); // lock released

		const store2 = createConversationStore('s1');
		store2.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r2')] });
		const { fetch: fetch2 } = respondFetch('throw');
		const orch2 = createPollingOrchestrator(store2, { fetchFn: fetch2, setTimer: () => 0, clearTimer: () => {} });
		await orch2.respond('r2', { approvalId: 'apr-r2', outcome: 'allowed-once' });
		expect(store2.answerList[0]?.phase).toBe('waiting');
	});

	it('poll carries the ack param once settlements were consumed', async () => {
		const store = createConversationStore('s1');
		store.applyPoll({ entries: [], lastSeq: 0, running: false, pendingAnswers: [pendingApproval('r1')] });
		store.applyPoll({ entries: [], lastSeq: 0, running: false, settledAnswers: [settlement('r1', 'rejected')] });
		const urls: string[] = [];
		const impl = (async (url: string | URL | Request) => {
			const href = String(url);
			urls.push(href);
			return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: 0, running: false }), { status: 200 });
		}) as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });
		await orch.start();
		expect(urls[0]).toContain('acked=r1');
	});
});

describe('store — optimistic R-3 contract (task 2.4)', () => {
	it('addOptimisticUserEntry returns the local id; imageCount lands only when > 0', () => {
		const store = createConversationStore('s1');
		const id = store.addOptimisticUserEntry('Hi');
		expect(id.startsWith('local:')).toBe(true);
		const plain = store.entries.find((e) => e.id === id) as { imageCount?: number };
		expect('imageCount' in plain).toBe(false);

		const imgId = store.addOptimisticUserEntry('', 2);
		const carrying = store.entries.find((e) => e.id === imgId) as { imageCount?: number };
		expect(carrying.imageCount).toBe(2);
	});

	it('dropOptimistic(id) drops exactly one bubble among same-text siblings (R-3 regression)', () => {
		const store = createConversationStore('s1');
		const first = store.addOptimisticUserEntry('', 1); // attachments-only
		const second = store.addOptimisticUserEntry('', 3); // attachments-only sibling
		store.dropOptimistic(first);
		const remainingLocals = store.entries.filter(
			(e) => e.kind === 'user-message' && 'local' in e && (e as { local?: boolean }).local === true
		);
		expect(remainingLocals).toHaveLength(1);
		expect((remainingLocals[0] as { id: string }).id).toBe(second);
	});

	it('dedupe twins match on (text, imageCount) — a text twin never consumes an image bubble (task 3.1)', () => {
		const store = createConversationStore('s1');
		const imgId = store.addOptimisticUserEntry('note', 1); // image-carrying local
		store.addOptimisticUserEntry('note', 0); // text-only local, same text
		// The ledger lands ONLY the text-only durable twin (the image send was
		// refused upstream) — via the POLL path (appendMany), which keeps
		// locals alive; it must consume the text local, never the image one.
		store.appendMany([{ kind: 'user-message', id: 'u:durable', seq: 5, time: 1000, text: 'note' }]);
		store.dedupeOptimistic();
		const locals = store.entries.filter(
			(e) => e.kind === 'user-message' && 'local' in e && (e as { local?: boolean }).local === true
		);
		expect(locals).toHaveLength(1);
		expect((locals[0] as { id: string }).id).toBe(imgId); // the image bubble survives honestly
	});

	it('dedupe consumes the image-carrying durable twin by (text, count) — gallery replaces the draft', () => {
		const store = createConversationStore('s1');
		const localId = store.addOptimisticUserEntry('look', 1);
		store.appendMany([
			{
				kind: 'user-message',
				id: 'u:durable-img',
				seq: 6,
				time: 1000,
				text: 'look',
				imageRefs: [{ attachmentId: 'sha256:a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }]
			}
		]);
		store.dedupeOptimistic();
		const locals = store.entries.filter(
			(e) => e.kind === 'user-message' && 'local' in e && (e as { local?: boolean }).local === true
		);
		expect(locals).toHaveLength(0); // consumed by its image twin
		expect(store.entries.some((e) => e.id === localId)).toBe(false);
		expect(
			store.entries.some(
				(e) => e.kind === 'user-message' && e.id === 'u:durable-img' && (e as { imageRefs?: unknown[] }).imageRefs?.length === 1
			)
		).toBe(true);
	});
});

describe('orchestrator — image submits (task 2.4)', () => {
	const IMG = { mediaType: 'image/png', data: 'AAAA', name: 'shot.png' };

	function mkOrch(script: { status: number; body: unknown }) {
		const store = createConversationStore('s1');
		const posts: string[] = [];
		const impl = (async (url: string | URL | Request, init?: RequestInit) => {
			if (String(url).includes('/prompt') && init?.method === 'POST') {
				posts.push(init.body as string);
				return new Response(JSON.stringify(script.body), {
					status: script.status,
					headers: { 'content-type': 'application/json' }
				});
			}
			return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: 0, running: false }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}) as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });
		return { store, posts, orch };
	}

	it('text-only submit keeps the byte-identical {text} body', async () => {
		const { posts, orch } = mkOrch({ status: 200, body: { ok: true, accepted: true } });
		expect(await orch.submit('Hi')).toBe(true);
		expect(JSON.parse(posts[0])).toEqual({ text: 'Hi' });
	});

	it('image submit posts {text, images} and tags the optimistic bubble imageCount', async () => {
		const { store, posts, orch } = mkOrch({ status: 200, body: { ok: true, accepted: true } });
		expect(await orch.submit('look', [IMG])).toBe(true);
		expect(JSON.parse(posts[0])).toEqual({ text: 'look', images: [IMG] });
		const carrying = store.entries.find(
			(e) => e.kind === 'user-message' && 'local' in e && (e as { local?: boolean }).local === true
		) as { imageCount?: number };
		expect(carrying.imageCount).toBe(1);
	});

	it('rejected attachments-only submit drops exactly its bubble by id — banner set, false returned', async () => {
		const { store, orch } = mkOrch({
			status: 502,
			// Real-host wire shape (api-proxy AttachmentError mapping):
			// code 'attachment-error' + details.reason — the panel routes on these.
			body: {
				ok: false,
				error: {
					code: 'attachment-error',
					message: 'stub: image exceeds limit',
					details: { reason: 'IMAGE_TOO_LARGE' }
				}
			}
		});
		// A prior attachments-only bubble shares text '' — the exact R-3 trap.
		const sibling = store.addOptimisticUserEntry('', 5);
		expect(await orch.submit('', [IMG])).toBe(false);
		expect(store.error?.message).toContain('image exceeds limit');
		expect(store.error?.code).toBe('attachment-error');
		expect(store.error?.reason).toBe('IMAGE_TOO_LARGE');
		const locals = store.entries.filter(
			(e) => e.kind === 'user-message' && 'local' in e && (e as { local?: boolean }).local === true
		);
		expect(locals).toHaveLength(1);
		expect((locals[0] as { id: string }).id).toBe(sibling); // sibling untouched, phantom dropped
	});
});

describe('orchestrator — failure + respond lanes (coverage gap)', () => {
	const okPoll = () => new Response(JSON.stringify({ ok: true, entries: [], lastSeq: 0, running: false }), { status: 200 });

	it('a failed poll (HTTP 500) sets the poll-failed banner and keeps scheduling', async () => {
		const store = createConversationStore('s1');
		const tasks: Array<() => void> = [];
		const impl = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
		const orch = createPollingOrchestrator(store, {
			fetchFn: impl,
			setTimer: (fn) => {
				tasks.push(fn);
				return tasks.length - 1;
			},
			clearTimer: () => {}
		});
		await orch.start();
		expect(store.error?.message).toBe('poll failed (500)');
		expect(tasks).toHaveLength(1); // still scheduled
	});

	it('a failed resync (HTTP 503) sets the resync-failed banner', async () => {
		const store = createConversationStore('s1');
		const impl = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });
		await orch.resync();
		expect(store.error?.message).toBe('resync failed (503)');
	});

	it('resync feeds pending/settled state into the store — a gap-resync page still renders its cards (2026-08-31 resync-drop fix)', async () => {
		const store = createConversationStore('s1');
		const impl = (async () =>
			new Response(
				JSON.stringify({
					ok: true,
					entries: [],
					lastSeq: 10,
					running: false,
					pendingAnswers: [pendingApproval('r1')]
				}),
				{ status: 200 }
			)) as unknown as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });
		await orch.resync();
		expect(store.answerList).toHaveLength(1);
		expect(store.answerList[0]?.rpcId).toBe('r1');
		expect(store.answerList[0]?.phase).toBe('waiting');
	});

	it('submit with images carries the {text, images} body (byte-shape, task 2.4)', async () => {
		const store = createConversationStore('s1');
		let seenBody: Record<string, unknown> | undefined;
		const impl = (async (url: string | URL | Request, init?: RequestInit) => {
			if (String(url).includes('/prompt')) {
				seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return new Response(JSON.stringify({ ok: true, accepted: true }), { status: 200 });
			}
			return okPoll();
		}) as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });
		await orch.start();
		const sent = await orch.submit('look', [{ mediaType: 'image/png', data: 'AAAA', name: 'shot.png' }]);
		expect(sent).toBe(true);
		expect(seenBody).toEqual({
			text: 'look',
			images: [{ mediaType: 'image/png', data: 'AAAA', name: 'shot.png' }]
		});
	});

	it('submit transport failure: banner, bubble dropped, false (never throws)', async () => {
		const store = createConversationStore('s1');
		const impl = (async (url: string | URL | Request) => {
			if (String(url).includes('/prompt')) throw new TypeError('Failed to fetch');
			return okPoll();
		}) as unknown as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });
		await orch.start();
		const sent = await orch.submit('Hi');
		expect(sent).toBe(false);
		expect(store.error?.message).toBe('Failed to fetch');
		expect(store.entries.some((e) => e.kind === 'user-message' && e.text === 'Hi')).toBe(false);
	});

	it('cancel() transport failure answers false (never throws)', async () => {
		const store = createConversationStore('s1');
		const impl = (async (url: string | URL | Request) => {
			if (String(url).includes('/cancel')) throw new TypeError('net down');
			return okPoll();
		}) as unknown as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });
		await expect(orch.cancel()).resolves.toBe(false);
	});

	it('the running getter mirrors the store (BC-7 surface)', async () => {
		const store = createConversationStore('s1');
		const impl = (async () => new Response(JSON.stringify({ ok: true, entries: [], lastSeq: 1, running: true }), { status: 200 })) as typeof fetch;
		const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });
		expect(orch.running).toBe(false);
		await orch.start();
		expect(orch.running).toBe(true);
	});

	describe('respond — lock, transport, and refusal lanes', () => {
		function storeWithPendingApproval() {
			const store = createConversationStore('s1');
			store.applyPoll({
				entries: [],
				lastSeq: 0,
				running: false,
				pendingAnswers: [
					{ rpcId: 'rpc-a', sessionId: 's1', kind: 'approval', body: { approvalId: 'apr-1', toolName: 'bash' }, receivedAt: 1 }
				]
			});
			return store;
		}

		it('an in-flight lock answers {ok:false, reason:"in-flight"} without a POST', async () => {
			const store = storeWithPendingApproval();
			let posts = 0;
			const impl = (async () => {
				posts += 1;
				return new Response(JSON.stringify({ ok: true, accepted: true }), { status: 200 });
			}) as typeof fetch;
			const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });
			const first = orch.respond('rpc-a', { approvalId: 'apr-1', outcome: 'allowed-once' }); // takes the lock
			const second = await orch.respond('rpc-a', { approvalId: 'apr-1', outcome: 'allowed-once' }); // locked out
			expect(second).toEqual({ ok: false, reason: 'in-flight' });
			await first;
			expect(posts).toBe(1); // only the winner POSTed
		});

		it('HTTP failure releases the lock — the card stays answerable', async () => {
			const store = storeWithPendingApproval();
			const impl = (async (url: string | URL | Request) => {
				if (String(url).includes('/respond')) return new Response('down', { status: 503 });
				return okPoll();
			}) as typeof fetch;
			const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });
			const out = await orch.respond('rpc-a', { approvalId: 'apr-1', outcome: 'allowed-once' });
			expect(out).toEqual({ ok: false, reason: 'respond failed (503)' });
			// The lock released: a retry may proceed.
			const retry = await orch.respond('rpc-a', { approvalId: 'apr-1', outcome: 'allowed-once' });
			expect(retry.reason).toBe('respond failed (503)'); // lock was FREE (not in-flight)
		});

		it('a not-ok body surfaces the wire reason; transport throw releases the lock', async () => {
			const store = storeWithPendingApproval();
			let mode: 'body' | 'throw' = 'body';
			const impl = (async (url: string | URL | Request) => {
				if (String(url).includes('/respond')) {
					if (mode === 'throw') throw new TypeError('net gone');
					return new Response(JSON.stringify({ ok: false, reason: 'stale-claim' }), { status: 200 });
				}
				return okPoll();
			}) as unknown as typeof fetch;
			const orch = createPollingOrchestrator(store, { fetchFn: impl, setTimer: () => 0, clearTimer: () => {} });

			const refused = await orch.respond('rpc-a', { approvalId: 'apr-1', outcome: 'allowed-once' });
			expect(refused).toEqual({ ok: false, reason: 'stale-claim' });

			mode = 'throw';
			const threw = await orch.respond('rpc-a', { approvalId: 'apr-1', outcome: 'allowed-once' });
			expect(threw.ok).toBe(false);
			expect(threw.reason).toBe('net gone');
		});
	});
});

describe('conversation store — system-prompt collapse across merge points (2026-09-01)', () => {
	const sp = (seq: number, text: string): DsiEntry => ({
		kind: 'system-prompt', id: `sp:${seq}`, seq, time: 1000 + seq, text
	});
	const count = (store: { entries: DsiEntry[] }): number =>
		store.entries.filter((e) => e.kind === 'system-prompt').length;

	it('appendMany drops a delta header whose text the list already holds', () => {
		const store = createConversationStore('s1');
		store.replaceAll([sp(1, 'S'), userEntry('hi')]);
		store.appendMany([sp(2, 'S')]);
		expect(count(store)).toBe(1);
	});

	it('appendMany keeps a genuinely NEW prompt text (a change is a visible row)', () => {
		const store = createConversationStore('s1');
		store.replaceAll([sp(1, 'S'), userEntry('hi')]);
		store.appendMany([sp(2, 'S2')]);
		expect(count(store)).toBe(2);
	});

	it('prependOlder collapses across the page boundary (older re-header vs newer row)', () => {
		const store = createConversationStore('s1');
		store.replaceAll([sp(9, 'S'), userEntry('hi')]);
		const added = store.prependOlder([
			sp(1, 'S'),
			{ kind: 'user-message', id: 'u:old', seq: 4, time: 900, text: 'old' }
		]);
		expect(added).toBe(true);
		expect(count(store)).toBe(1);
		expect(store.entries[0]?.kind).toBe('system-prompt');
	});
});
