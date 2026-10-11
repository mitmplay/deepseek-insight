/**
 * session-state-store tests — direct unit coverage of the per-session
 * state machines (ADR-0022 W2): follow ring buffers, the running map +
 * re-baseline seed race bookkeeping, and the seq-less live assistant
 * stream tails. Pure store, constructor-injected deps — no transport.
 */
import { describe, expect, it } from 'vitest';
import type { DshSessionEvent } from '$lib/server/dsh-connection';
import { SessionStateStore, type SessionStateStoreDeps } from '$lib/server/connection/session-state';

function ev(seq: number, type = 'assistant/message'): DshSessionEvent {
	return { type, seq, time: seq * 10, data: {} } as unknown as DshSessionEvent;
}

function makeDeps(over: Partial<SessionStateStoreDeps> = {}): SessionStateStoreDeps & { logs: unknown[][] } {
	const logs: unknown[][] = [];
	return {
		logs,
		log: (...args: unknown[]) => void logs.push(args),
		ringCapacity: () => 10,
		listSessions: async () => ({ items: [] }),
		generation: () => 1,
		disposed: () => false,
		...over
	} as unknown as SessionStateStoreDeps & { logs: unknown[][] };
}

describe('SessionStateStore — running map + seed races', () => {
	it('setRunning/isRunning: set, overwrite, and the missing-key default', () => {
		const store = new SessionStateStore(makeDeps());
		expect(store.isRunning('s1')).toBe(false);
		store.setRunning('s1', true);
		expect(store.isRunning('s1')).toBe(true);
		store.setRunning('s1', false);
		expect(store.isRunning('s1')).toBe(false);
	});

	it('onHostFrame: only host/session-status frames with a string sessionId land', () => {
		const store = new SessionStateStore(makeDeps());
		store.onHostFrame(null);
		store.onHostFrame({ type: 'other' });
		store.onHostFrame({ type: 'host/session-status' }); // sessionId not a string
		expect(store.isRunning('s1')).toBe(false);
		store.onHostFrame({ type: 'host/session-status', sessionId: 's1', running: 1 });
		expect(store.isRunning('s1')).toBe(true);
		store.onHostFrame({ type: 'host/session-status', sessionId: 's2' }); // running undefined
		expect(store.isRunning('s2')).toBe(false);
	});

	it('seedRunning: re-baselines from the ledger; racing pushes stay fresher', async () => {
		const deps = makeDeps({
			listSessions: async () => ({
				items: [
					{ sessionId: 's1', running: false },
					{ sessionId: 's3', running: true }
				]
			})
		} as never);
		const store = new SessionStateStore(deps);
		store.setRunning('s1', true);
		store.setRunning('stale', true);
		const seeding = store.seedRunning();
		// the race lands DURING the ledger await — seedRunning resets the race
		// set up front, so a push captured before it is not a race anymore
		store.onHostFrame({ type: 'host/session-status', sessionId: 's1', running: true });
		await seeding;
		expect(store.isRunning('s1')).toBe(true); // the racing push wins over the ledger row
		expect(store.isRunning('s3')).toBe(true);
		expect(store.isRunning('stale')).toBe(false); // dropped — not in the ledger
		expect(deps.logs.some((l) => String(l[0]).includes('re-baselined (2 sessions)'))).toBe(true);
	});

	it('seedRunning: a stale generation aborts the swap silently', async () => {
		// each call advances the generation — the second read inside
		// seedRunning sees a NEW generation, i.e. a reconnect mid-seed
		let gen = 0;
		const store = new SessionStateStore(makeDeps({ generation: () => ++gen }));
		store.setRunning('s1', true);
		await store.seedRunning();
		expect(store.isRunning('s1')).toBe(true); // map untouched
	});

	it('seedRunning: disposed aborts the swap (the ledger read never lands)', async () => {
		let gone = false;
		const deps = makeDeps({
			disposed: () => gone,
			listSessions: async () => {
				gone = true;
				return { items: [] };
			}
		} as never);
		const store = new SessionStateStore(deps);
		store.setRunning('s1', true);
		await store.seedRunning(); // disposed() flips true before the swap
		expect(store.isRunning('s1')).toBe(true);
	});

	it('seedRunning: a listSessions rejection logs the failure', async () => {
		const deps = makeDeps({
			listSessions: async () => {
				throw new Error('mux down');
			}
		} as never);
		const store = new SessionStateStore(deps);
		store.setRunning('s1', true);
		await store.seedRunning();
		expect(deps.logs.some((l) => String(l[0]).includes('re-baseline failed'))).toBe(true);
		expect(store.isRunning('s1')).toBe(true); // pushes stay authoritative
	});
});

describe('SessionStateStore — ring buffers', () => {
	it('bufferKeys/dispose/hasBaseline: lifecycle of the buffer map', () => {
		const store = new SessionStateStore(makeDeps());
		expect(store.hasBaseline('s1')).toBe(false);
		expect([...store.bufferKeys()]).toEqual([]);
		store.seedBaseline('s1', 5);
		expect([...store.bufferKeys()]).toEqual(['s1']);
		expect(store.hasBaseline('s1')).toBe(true);
		store.setRunning('s1', true);
		store.onAssistantStreamFrame('s1', { type: 'start' } as never);
		store.dispose();
		expect([...store.bufferKeys()]).toEqual([]);
		expect(store.hasBaseline('s1')).toBe(false);
		expect(store.isRunning('s1')).toBe(false);
		expect(store.liveAssistantStream('s1')).toBeNull();
	});

	it('seedBaseline: fresh baselines adopt; a rewind resets the buffered entries', () => {
		const store = new SessionStateStore(makeDeps());
		store.seedBaseline('s1', 5);
		store.seedBaseline('s1', 7); // higher, entries still empty → adopt again
		store.appendEvent('s1', ev(8));
		store.seedBaseline('s1', 9); // higher WITH entries → no-op (entries kept)
		expect(store.eventsSince('s1', 6).events.map((e) => e.seq)).toEqual([8]);
		store.seedBaseline('s1', 2); // REWIND below the high-water mark → reset
		expect(store.eventsSince('s1', 0).events).toEqual([]);
		expect(store.hasBaseline('s1')).toBe(true);
	});

	it('seedSnapshotCursor: cursor above adopts, below resets, equal is a no-op', () => {
		const store = new SessionStateStore(makeDeps());
		store.seedSnapshotCursor('s1', 5);
		expect(store.hasBaseline('s1')).toBe(true);
		store.seedSnapshotCursor('s1', 5); // equal to lastSeq → neither branch
		store.appendEvent('s1', ev(6));
		expect(store.eventsSince('s1', 5).events.length).toBe(1);
		store.seedSnapshotCursor('s1', 1); // below → reset
		expect(store.eventsSince('s1', 0).events).toEqual([]);
	});

	it('appendEvent: seq gap raises the coverage floor; dense and stale seqs do not', () => {
		const deps = makeDeps();
		const store = new SessionStateStore(deps);
		store.appendEvent('s1', ev(1));
		store.appendEvent('s1', ev(2)); // dense — no gap branch
		store.appendEvent('s1', ev(0)); // stale — ignored entirely
		expect(store.eventsSince('s1', 0).events.map((e) => e.seq)).toEqual([1, 2]);
		store.appendEvent('s1', ev(9)); // gap 2 → 9
		expect(deps.logs.some((l) => String(l[0]).includes('seq gap for s1'))).toBe(true);
		expect(store.eventsSince('s1', 3).gap).toBe(true); // delta starts above the seam
		expect(store.eventsSince('s1', 8).gap).toBe(false);
		expect(store.eventsSince('s1', 9).gap).toBe(false); // empty delta: never a gap
	});

	it('appendEvent: the ring capacity splices the oldest entries off', () => {
		const store = new SessionStateStore(makeDeps({ ringCapacity: () => 2 }));
		store.appendEvent('s1', ev(1));
		store.appendEvent('s1', ev(2));
		store.appendEvent('s1', ev(3));
		expect(store.eventsSince('s1', 0).events.map((e) => e.seq)).toEqual([2, 3]);
	});
});

describe('SessionStateStore — live assistant stream tails', () => {
	const start = {
		type: 'start',
		attemptId: 'a1',
		turn: 2,
		step: 1,
		startedAfterSeq: 40
	};

	it('start/chunk/end lifecycle: deltas accumulate, the end clears the tail', () => {
		const store = new SessionStateStore(makeDeps());
		expect(store.liveAssistantStream('s1')).toBeNull();
		store.onAssistantStreamFrame('s1', start as never);
		store.onAssistantStreamFrame('s1', {
			type: 'chunk',
			attemptId: 'a1',
			index: 0,
			chunk: { type: 'text-delta', text: 'hello ' },
			time: 111
		} as never);
		store.onAssistantStreamFrame('s1', {
			type: 'chunk',
			attemptId: 'a1',
			index: 1,
			chunk: { type: 'reasoning-delta', text: 'think' }
		} as never);
		store.onAssistantStreamFrame('s1', {
			type: 'chunk',
			attemptId: 'a1',
			index: 2,
			chunk: { type: 'tool-call' } // not transcript surface
		} as never);
		store.onAssistantStreamFrame('s1', {
			type: 'chunk',
			attemptId: 'a1',
			index: 3,
			chunk: { type: 'block' } // no chunk.text — neither arm
		} as never);
		const tail = store.liveAssistantStream('s1')!;
		expect(tail).toMatchObject({
			id: 'a:2:1',
			turn: 2,
			step: 1,
			seq: 40,
			text: 'hello ',
			reasoning: 'think'
		});
		expect(tail.time).toBe(111); // the last frame's time rode in
		store.onAssistantStreamFrame('s1', { type: 'end' } as never);
		expect(store.liveAssistantStream('s1')).toBeNull();
	});

	it('chunks before a start are dropped; foreign/wrong-index chunks kill the tail', () => {
		const store = new SessionStateStore(makeDeps());
		store.onAssistantStreamFrame('s1', {
			type: 'chunk',
			attemptId: 'a1',
			index: 0,
			chunk: { type: 'text-delta', text: 'x' }
		} as never);
		expect(store.liveAssistantStream('s1')).toBeNull(); // no tail yet
		store.onAssistantStreamFrame('s1', start as never);
		store.onAssistantStreamFrame('s1', {
			type: 'chunk',
			attemptId: 'other', // foreign attempt
			index: 0,
			chunk: { type: 'text-delta', text: 'x' }
		} as never);
		expect(store.liveAssistantStream('s1')).toBeNull();
		store.onAssistantStreamFrame('s1', start as never);
		store.onAssistantStreamFrame('s1', {
			type: 'chunk',
			attemptId: 'a1',
			index: 5, // non-dense index
			chunk: { type: 'text-delta', text: 'x' }
		} as never);
		expect(store.liveAssistantStream('s1')).toBeNull();
	});

	it('a chunk without a numeric time keeps the previous lastTime', () => {
		const store = new SessionStateStore(makeDeps());
		store.onAssistantStreamFrame('s1', start as never);
		store.onAssistantStreamFrame('s1', {
			type: 'chunk',
			attemptId: 'a1',
			index: 0,
			chunk: { type: 'text-delta', text: 'x' },
			time: 500
		} as never);
		store.onAssistantStreamFrame('s1', {
			type: 'chunk',
			attemptId: 'a1',
			index: 1,
			chunk: { type: 'text-delta', text: 'y' }
		} as never);
		expect(store.liveAssistantStream('s1')!.time).toBe(500);
	});

	it('seedLiveTailFromBaseline: absent baseline deletes; an active attempt replays deltas', () => {
		const store = new SessionStateStore(makeDeps());
		store.onAssistantStreamFrame('s1', start as never);
		store.seedLiveTailFromBaseline('s1', undefined);
		expect(store.liveAssistantStream('s1')).toBeNull();
		store.seedLiveTailFromBaseline('s1', { activeAttempt: undefined } as never);
		expect(store.liveAssistantStream('s1')).toBeNull();
		store.seedLiveTailFromBaseline('s1', {
			activeAttempt: {
				attemptId: 'a2',
				turn: 3,
				step: 2,
				startedAfterSeq: 70,
				nextIndex: 2,
				stream: [
					{ type: 'text-chunks', texts: ['a', 1, 'b'], time0: 100, dt: [5, 5] },
					{ type: 'reasoning-chunks', texts: 'not-an-array' },
					{ type: 'tool-call-chunks', time0: 1, dt: [1] },
					{ type: 'chunk', time: 123 }
				]
			}
		} as never);
		const tail = store.liveAssistantStream('s1')!;
		expect(tail).toMatchObject({
			id: 'a:3:2',
			turn: 3,
			step: 2,
			seq: 70,
			text: 'ab', // the non-string member is filtered out
			reasoning: ''
		});
		expect(tail.time).toBe(123); // the bare chunk's time is the latest
	});
});