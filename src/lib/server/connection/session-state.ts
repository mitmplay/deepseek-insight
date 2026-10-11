/**
 * connection/session-state — the per-session state machines (ADR-0022 W2,
 * ADR-0019 move-whole): follow ring buffers (freshness only; the ledger is
 * the truth), the running map + its 2026-08-26 re-baseline seed race
 * bookkeeping, and the seq-less live assistant-stream tails (0.1.3-alpha.1).
 */
import type {
	DshSessionEvent,
	SessionAssistantStreamBaselineLike,
	SessionAssistantStreamFrameLike
} from '$lib/server/dsh-connection';
import type { DsiLiveStreamTail } from '$lib/types';
import { compactRecordTailTime } from './normalize';
import type { ListResult } from './normalize';

/** Constructor-injected shell services: the store owns no transport. */
export interface SessionStateStoreDeps {
	log: (...args: unknown[]) => void;
	ringCapacity: () => number;
	listSessions: () => Promise<ListResult>;
	/** Current mux generation (downlink lifecycle lives in the shell/W3). */
	generation: () => number;
	disposed: () => boolean;
}
export interface SessionBuffer {
	entries: DshSessionEvent[];
	lastSeq: number;
	/**
	 * Lowest seq still covered by the buffer (Wave 4.2 gap detection).
	 * When the mux drops, frames between the last delivered event and the
	 * next one are lost: coverageFloor rises past the client's `since` mark
	 * and the next poll reports a gap → ledger resync (BC-4: the ledger is
	 * the truth; the ring buffer is freshness only).
	 */
	coverageFloor: number;
}

interface LiveAssistantTail {
	attemptId: string;
	turn: number;
	step: number;
	/** Last durable seq when the attempt started — the client merge/dedupe
	 *  token, strictly below every seq this attempt can settle at. */
	startedAfterSeq: number;
	startedAt: number;
	lastTime: number;
	text: string;
	reasoning: string;
	/** Expected dense index of the next chunk frame. */
	nextIndex: number;
}

export class SessionStateStore {
	private readonly deps: SessionStateStoreDeps;
	private readonly log: (...args: unknown[]) => void;
	private buffers = new Map<string, SessionBuffer>();
	private running = new Map<string, boolean>();
	private liveTails = new Map<string, LiveAssistantTail>();
	private runningSeedRaces = new Set<string>();

	constructor(deps: SessionStateStoreDeps) {
		this.deps = deps;
		this.log = deps.log;
	}

	public setRunning(sessionId: string, running: boolean): void {
		this.running.set(sessionId, running);
	}

	public bufferKeys(): IterableIterator<string> {
		return this.buffers.keys();
	}

	public dispose(): void {
		this.buffers.clear();
		this.liveTails.clear();
		this.running.clear();
		this.runningSeedRaces.clear();
	}


	onHostFrame(payload: unknown): void {
		const frame = payload as { type: string; sessionId?: string; running?: boolean };
		if (frame?.type === 'host/session-status' && typeof frame.sessionId === 'string') {
			this.runningSeedRaces.add(frame.sessionId);
			this.running.set(frame.sessionId, Boolean(frame.running));
		}
	}

	async seedRunning(): Promise<void> {
		const generation = this.deps.generation();
		this.runningSeedRaces = new Set();
		try {
			const { items } = await this.deps.listSessions();
			if (this.deps.disposed() || generation !== this.deps.generation()) return;
			const races = this.runningSeedRaces;
			const next = new Map<string, boolean>();
			for (const [id, running] of this.running) {
				if (races.has(id)) next.set(id, running); // racing push is fresher
			}
			for (const row of items) {
				if (!races.has(row.sessionId)) next.set(row.sessionId, row.running);
			}
			this.running = next;
			this.log(`dsh-connection: running map re-baselined (${items.length} sessions)`);
		} catch (err) {
			// Never fatal: pushes remain the live path; the next reconnect retries.
			this.log('dsh-connection: running re-baseline failed — pushes stay authoritative', err);
		}
	}

	bufferFor(sessionId: string): SessionBuffer {
		let buf = this.buffers.get(sessionId);
		if (!buf) {
			buf = { entries: [], lastSeq: -1, coverageFloor: -1 };
			this.buffers.set(sessionId, buf);
		}
		return buf;
	}

	seedBaseline(sessionId: string, lastSeq: number): void {
		const buf = this.bufferFor(sessionId);
		if (lastSeq > buf.lastSeq && buf.entries.length === 0) {
			buf.lastSeq = lastSeq;
			buf.coverageFloor = lastSeq;
			return;
		}
		// Stream restart (Wave 2): the new baseline sits BELOW the buffered
		// high-water mark — the upstream was rebuilt (e2e stub lifecycle; a
		// re-seeded host) and every buffered entry above the baseline belongs
		// to the dead instance, silently filtering the replayed ledger (the
		// poll then stalls on "nothing new" while appendEvent drops every
		// rewound seq). The baseline is authoritative for stream position:
		// reset the buffer and let replay re-fill it.
		if (buf.lastSeq >= 0 && lastSeq < buf.lastSeq) {
			buf.entries.length = 0;
			buf.lastSeq = lastSeq;
			buf.coverageFloor = lastSeq;
		}
	}

	seedSnapshotCursor(sessionId: string, cursor: number): void {
		const buf = this.bufferFor(sessionId);
		if (cursor > buf.lastSeq) {
			buf.lastSeq = cursor;
			buf.coverageFloor = cursor;
			return;
		}
		if (buf.lastSeq >= 0 && cursor < buf.lastSeq) {
			buf.entries.length = 0;
			buf.lastSeq = cursor;
			buf.coverageFloor = cursor;
		}
	}

	appendEvent(sessionId: string, event: DshSessionEvent): void {
		const buf = this.bufferFor(sessionId);
		if (event.seq > buf.lastSeq) {
			// Wave 4.2 — gap detection: after a mux drop the stream resumes at a
			// higher seq than the buffer's last. The hole between is durable on
			// the host but lost to this buffer; raise the coverage floor so the
			// next poll asking `since` below it learns the truth.
			if (buf.lastSeq >= 0 && event.seq > buf.lastSeq + 1) {
				buf.coverageFloor = Math.max(buf.coverageFloor, buf.lastSeq);
				this.log(
					`dsh-connection: seq gap for ${sessionId} (${buf.lastSeq} → ${event.seq}) — resync required below ${event.seq}`
				);
			}
			buf.lastSeq = event.seq;
			buf.entries.push(event);
			const cap = this.deps.ringCapacity();
			if (buf.entries.length > cap) {
				buf.entries.splice(0, buf.entries.length - cap);
			}
		}
	}

	onAssistantStreamFrame(sessionId: string, frame: SessionAssistantStreamFrameLike): void {
		if (frame.type === 'start') {
			this.liveTails.set(sessionId, {
				attemptId: frame.attemptId,
				turn: frame.turn,
				step: frame.step,
				startedAfterSeq: frame.startedAfterSeq,
				startedAt: Date.now(),
				lastTime: Date.now(),
				text: '',
				reasoning: '',
				nextIndex: 0
			});
			return;
		}
		const tail = this.liveTails.get(sessionId);
		if (tail === undefined) return;
		if (frame.type === 'chunk') {
			// Continuity guard mirrors the host's accumulator: a foreign
			// attemptId or a non-dense index means the tail is stale — drop
			// it and wait for the host's next start (frames stop anyway).
			if (frame.attemptId !== tail.attemptId || frame.index !== tail.nextIndex) {
				this.liveTails.delete(sessionId);
				return;
			}
			const kind = frame.chunk?.type;
			if (kind === 'text-delta' && typeof frame.chunk?.text === 'string') {
				tail.text += frame.chunk.text;
			} else if (kind === 'reasoning-delta' && typeof frame.chunk?.text === 'string') {
				tail.reasoning += frame.chunk.text;
			}
			// tool-call deltas (superseded by the durable tool/call event) and
			// block/usage/finish markers are not transcript surface.
			tail.nextIndex += 1;
			if (typeof frame.time === 'number') tail.lastTime = frame.time;
			return;
		}
		// end (committed or abandoned): the tail is done. A committed
		// assistant/message finalizes the client bubble through the durable
		// event; assistant/attempt settlements and abandons clear it via the
		// poll's null liveStream — one rule, no outcome-specific client work.
		this.liveTails.delete(sessionId);
	}

	seedLiveTailFromBaseline(
		sessionId: string,
		baseline: SessionAssistantStreamBaselineLike | undefined
	): void {
		const active = baseline?.activeAttempt;
		if (active === undefined) {
			this.liveTails.delete(sessionId);
			return;
		}
		const tail: LiveAssistantTail = {
			attemptId: active.attemptId,
			turn: active.turn,
			step: active.step,
			startedAfterSeq: active.startedAfterSeq,
			startedAt: Date.now(),
			lastTime: Date.now(),
			text: '',
			reasoning: '',
			nextIndex: active.nextIndex
		};
		for (const record of active.stream ?? []) {
			// Only the delta runs carry transcript surface; tool-call runs are
			// superseded by the durable tool/call event, bare chunks (block
			// boundaries, usage, finish) are not surface at all.
			if (record.type === 'text-chunks' || record.type === 'reasoning-chunks') {
				const texts = record.texts;
				const joined = Array.isArray(texts) ? texts.filter((t) => typeof t === 'string').join('') : '';
				if (record.type === 'text-chunks') tail.text += joined;
				else tail.reasoning += joined;
			}
			// The latest member time rides the last record that carries one
			// (run: time0 + Σdt; bare chunk: time) — the bubble's wire time.
			const times = compactRecordTailTime(record);
			if (times !== undefined) tail.lastTime = times;
		}
		this.liveTails.set(sessionId, tail);
	}

	liveAssistantStream(sessionId: string): DsiLiveStreamTail | null {
		const tail = this.liveTails.get(sessionId);
		if (tail === undefined) return null;
		return {
			id: `a:${String(tail.turn)}:${String(tail.step)}`,
			turn: tail.turn,
			step: tail.step,
			seq: tail.startedAfterSeq,
			time: tail.lastTime,
			text: tail.text,
			reasoning: tail.reasoning
		};
	}

	eventsSince(
		sessionId: string,
		n: number
	): { events: DshSessionEvent[]; lastSeq: number; running: boolean; gap: boolean } {
		const buf = this.bufferFor(sessionId);
		const events = buf.entries.filter((e) => e.seq > n);
		// Gap when the caller's mark n implies a next event (n+1) that the
		// buffer can no longer produce: the delta starts above the seam.
		// (An empty delta means "nothing new YET" — never a detectable gap.)
		const firstDelta = events[0]?.seq;
		const gap = firstDelta !== undefined && firstDelta > n + 1;
		return { events, lastSeq: buf.lastSeq, running: this.running.get(sessionId) ?? false, gap };
	}

	hasBaseline(sessionId: string): boolean {
		return this.buffers.has(sessionId) && this.bufferFor(sessionId).lastSeq >= 0;
	}

	isRunning(sessionId: string): boolean {
		return this.running.get(sessionId) ?? false;
	}

}
