/**
 * dsh-connection — the transport singleton (BC-5) owning every wire byte to
 * the DSH Host (BC-6: it speaks only through dsh-rpc helpers and the two
 * downlink WebSocket paths).
 *
 * State model (PRD §3.5):
 *   mux  frames (session/subscribed, session/event) → per-session ring buffer
 *   host frames (host/session-status)               → per-session running map
 *   running map re-baselines from session.list at every generation open
 *   (2026-08-26): the host pushes status only on TRANSITIONS and sends no
 *   initial snapshot, so a downlink rebuilt mid-turn would otherwise never
 *   learn the session was already running.
 *   ring buffer = freshness only; the ledger (session.history) is the truth —
 *   cold loads and every resync re-read the ledger (BC-4).
 *
 * Generation semantics (guide Part 1): the two downlinks form one generation;
 * if either dies, both are rebuilt after backoff.
 */

import { dshBaseUrl } from '$lib/config';
import { readDshAuthConfig, readDshPresetEnglishConfig, readServerConfig } from '$lib/server/insight-config';
import type { DshAttachmentValue, DshCommandReceipt, DshCommandRow, DshHistoryEntry, DshPromptContent, DshSkillList, DshWorkspaceDirectoryListing, DshWorkspaceFileBytes, DshWorkspaceFileText } from '$lib/server/dsh-rpc';
import {
	DSH_ARGS,
	DSH_METHODS,
	DSH_REMOTE_MUX_WS_PATH,
	REMOTE_EVENT_RESULT_ENDPOINT,
	REMOTE_EVENT_STREAM_ENDPOINT,
	REMOTE_EVENT_STREAM_PAYLOAD,
	DshAuth,
	DshRpcError,
	encodeRespond,
	parseResponse,
	parseRespondReceipt,
	respondUrl,
	rpcUrl,
	type RespondReceipt
} from '$lib/server/dsh-rpc';

/** Ring buffer capacity per session (entries kept for delta polls).
 *  Config-tunable (2026-08-25): ~/.dsi/settings.yaml `server.ringCapacity`
 *  overrides at runtime — this constant is the FALLBACK default (and the
 *  unit-test value; ringCapacity() reads the live config per trim). */
export const RING_CAPACITY = 500;

/** Live capacity from ~/.dsi/settings.yaml (no cache — runtime edits
 *  apply, same contract as every other config section). */
function ringCapacity(): number {
	return readServerConfig().ringCapacity;
}

/**
 * POC-3 W1 — an answerable frame awaiting a human (registry value).
 *
 * Transient CONTROL state, never a ledger entry (BC-E): requested frames are
 * replayed by the host on mux open; audit events stay in the ledger. The
 * rpcId is the wire-stable correlation for the respond carrier.
 */
export interface PendingAnswerFrame {
	rpcId: string;
	sessionId: string;
	kind: 'approval' | 'question';
	/** approval/requested: {approvalId, toolName, callId?, reason?} — question/requested: {questions:[…]} (verbatim wire payloads). */
	body: Record<string, unknown>;
	/** Monotonic arrival time (ms) — ordering for the UI, not wire truth. */
	receivedAt: number;
	/**
	 * DSI mux generation whose $events delivery last (re)registered this
	 * entry. The host replays every still-pending waterfall into each new
	 * generation, so an entry no newer generation confirms is finished —
	 * reaped when the generation's ready frame lands (see
	 * reapUnconfirmedPending).
	 */
	deliveredGen: number;
}

/** A settlement outcome for one rpcId (approval or question). */
export interface AnswerSettlement {
	rpcId: string;
	sessionId: string;
	kind: 'approval' | 'question';
	/** approval: 'allowed-once'|'rejected'|'cancelled'|… · question: 'answered'|'cancelled'. */
	outcome: string;
	settledAt: number;
}

/**
 * Catalog-invalidation listener (Slash Menu W1, task 1.3): the connection
 * fires these from the two $events emit arms + the socket-reset path —
 * 'all' when any session's vocabulary moved (commands/change, mux reset),
 * one sessionId when a preset switch retargeted it (agent-preset/selected).
 * The COMMUNICATION MAP's event-callback registry: server-side emitters;
 * the browser cache (slash-directory.svelte.ts) is bridged by the panel
 * wiring (Wave 2 task 2.3) — a server import of the browser module would
 * reach the wrong instance (SvelteKit compiles one per environment).
 */
export type CatalogInvalidationListener = (scope: string | 'all') => void;

export interface DshSessionEvent {
	type: string;
	seq: number;
	time: number;
	data?: Record<string, unknown>;
	/** Optional presentation view riding next to the event (render intent —
	 * bash declares {card:'terminal', title:command}; presentation.ts).
	 * Survives the ring buffer verbatim; dsh-events.callSummary reads
	 * view.view.title. Ledger-sourced pages already carried it (DshRawEvent). */
	view?: unknown;
}

/**
 * The host's live assistant-stream frames (0.1.3-alpha.1 follow channel,
 * `assistantStream: true`): browser wire form of one process-local model
 * attempt, interleaved with durable event entries on the same follow stream
 * in observation order. Frames carry NO seq — they are presentation state
 * and bypass the durable cursor bookkeeping. The raw `chunk` payload is one
 * StreamChunk as JSON (text-delta / reasoning-delta / tool-call-delta /
 * block-start / block-end / usage / finish).
 */
export type SessionAssistantStreamFrameLike = {
	type: 'start';
	attemptId: string;
	revision: number;
	startedAfterSeq: number;
	turn: number;
	step: number;
} | {
	type: 'chunk';
	attemptId: string;
	revision: number;
	/** Dense position — the host drops its own accumulator on any gap. */
	index: number;
	time: number;
	chunk: Record<string, unknown>;
} | {
	type: 'end';
	attemptId: string;
	revision: number;
	index: number;
	outcome:
		| { kind: 'committed'; eventType: 'assistant/message' | 'assistant/attempt'; seq: number }
		| { kind: 'abandoned' };
};

/** Follow-opening snapshot baseline (SessionAssistantStreamBaseline). */
export interface SessionAssistantStreamBaselineLike {
	revision: number;
	activeAttempt?: {
		attemptId: string;
		startedAfterSeq: number;
		turn: number;
		step: number;
		/** Dense position expected for the next live chunk frame. */
		nextIndex: number;
		/** Compact detached stream (AssistantStreamRecord[]) accumulated so far. */
		stream: Array<Record<string, unknown>>;
	};
}

/** One in-flight attempt folded from assistant-stream frames (internal).
 *  The client-facing shape is DsiLiveStreamTail ($lib/types). */
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

/** Injectable transports — tests pass fakes; production uses globals. */
export interface DshConnectionOptions {
	baseUrl?: string;
	fetchFn?: typeof fetch;
	wsFactory?: (url: string, headers?: Record<string, string>) => WebSocketLike;
	/** Auth carrier override (tests); production mints from config's launch token. */
	auth?: DshAuth;
	rpcIdFactory?: () => string;
	backoffScheduleMs?: number[];
	/**
	 * Grace between a $events generation's ready frame and the
	 * still-pending replay reap (tests shrink it; production uses the
	 * wire-derived default — the replay follows ready within one stream
	 * drain, so the slack only absorbs scheduling jitter).
	 */
	answerReapGraceMs?: number;
	/**
	 * How long a stale-generation answer retry waits for the rebuilt
	 * generation's ready frame (tests shrink it; production default covers
	 * a local mux rebuild plus replay).
	 */
	staleGenerationRetryMs?: number;
	log?: (...args: unknown[]) => void;
}

/** Minimal WebSocket surface the connection consumes. */
export interface WebSocketLike {
	addEventListener(ev: 'open', fn: () => void): void;
	addEventListener(ev: 'message', fn: (e: { data: unknown }) => void): void;
	addEventListener(ev: 'error', fn: () => void): void;
	addEventListener(ev: 'close', fn: () => void): void;
	/** Send one logical-stream client message (0.1.2 remote.mux). */
	send?(data: string): void;
	close(): void;
}

interface SessionBuffer {
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

/**
 * Parent-address facts for one subagent-origin session, folded from its
 * session.list row: the host requires spawned sessions to be addressed
 * `{kind:'subagent', parentSessionId, childSessionId, mode}` (packages/api/
 * session-controller/src/history.ts validateAddress) and rejects the plain
 * `{kind:'session'}` form with `agent-busy`. `mode` must equal the child
 * descriptor's lifecycle mode exactly (a mismatch → `subagent-unauthorized`),
 * so a row whose identity projection is unreadable keeps NO hint and the
 * honest-rejection path explains instead of guessing.
 */
interface SubagentAddressHint {
	parentSessionId: string;
	mode: 'one-shot' | 'continuable';
}

let singleton: DshConnection | undefined;

/** The process-wide transport (BC-5). Creates lazily on first use. */
export function getDshConnection(opts: DshConnectionOptions = {}): DshConnection {
	singleton ??= new DshConnection(opts);
	return singleton;
}

/** Test hook: drop the singleton so the next get starts a fresh one. */
export function resetDshConnectionForTests(): void {
	singleton?.dispose();
	singleton = undefined;
}

export class DshConnection {
	readonly baseUrl: string;
	private readonly fetchFn: typeof fetch;
	private readonly wsFactory: (url: string, headers?: Record<string, string>) => WebSocketLike;
	private readonly auth: DshAuth;
	private readonly rpcIdFactory: () => string;
	private readonly backoff: number[];
	private readonly log: (...args: unknown[]) => void;

	private buffers = new Map<string, SessionBuffer>();
	private running = new Map<string, boolean>();
	/**
	 * Live assistant-stream tails (0.1.3-alpha.1): the one in-flight model
	 * attempt per session, folded from the follow's seq-less assistant-stream
	 * frames. Presentation state only — never part of the durable cursor
	 * algebra (lastSeq/gap/coverage), because the frames carry no seq.
	 */
	private liveTails = new Map<string, LiveAssistantTail>();
	/**
	 * Session-ids that received a host/session-status push since the running
	 * re-baseline RPC was ISSUED (2026-08-26). A push is a strictly newer
	 * transition than an in-flight snapshot — the seed must never overwrite
	 * one. Swapped for a fresh set every time a seed is issued; read at
	 * apply time so pushes landing mid-flight are counted.
	 */
	private runningSeedRaces = new Set<string>();
	private wsMux: WebSocketLike | undefined;
	private generation = 0;
	/** Logical streams by streamId → owning socket (0.1.2 remote.mux). */
	private streamSockets = new Map<string, WebSocketLike>();
	/** Generation-scoped counter keeping stream ids unique across rebuilds. */
	private streamSeq = 0;
	/** $events generation clientId (RemoteEventReadyFrame; binds $events/result). */
	private eventClientId: string | null = null;
	/** True once the carrier's OPEN event fired (sends are legal). */
	private opened = false;
	/** Per-session projection baselines (follow snapshot + control frames; W2). */
	private projections = new Map<string, RawSessionProjections>();
	/** Workspace registry cache from workspace/follow (W2; authority = host). */
	private workspaces: DsiWorkspaceSummary[] = [];
	/** Waiters resolved by the first workspace/follow baseline (one-shot). */
	private workspaceBaselineWaiters = new Set<PromiseWithResolvers<void>>();
	/** Subscribes parked while the carrier is CONNECTING (flushed on open). */
	private pendingSubscribes = new Set<string>();
	/**
	 * Parent-address hints for subagent-origin sessions (SubagentAddressHint),
	 * folded from session.list rows by rawListSessions.
	 */
	private subagentHints = new Map<string, SubagentAddressHint>();
	/** Session-ids whose hint absence was already probed with a list pass
	 *  (one probe per session lifetime — ordinary sessions never re-probe). */
	private hintProbed = new Set<string>();
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	/** Wave 4.2 — consecutive failed generations; drives the backoff ladder. */
	private reconnectAttempt = 0;
	/** Reap grace (see DshConnectionOptions.answerReapGraceMs). */
	private readonly answerReapGraceMs: number;
	private answerReapTimer: ReturnType<typeof setTimeout> | undefined;
	/** Stale-generation retry deadline (see DshConnectionOptions.staleGenerationRetryMs). */
	private readonly staleGenerationRetryMs: number;

	constructor(opts: DshConnectionOptions = {}) {
		this.baseUrl = opts.baseUrl ?? dshBaseUrl();
		this.fetchFn = opts.fetchFn ?? fetch;
		this.wsFactory = opts.wsFactory
			?? ((url: string, headers?: Record<string, string>) =>
				new WebSocket(url, (headers === undefined ? undefined : { headers }) as never));
		this.auth = opts.auth ?? new DshAuth({ baseUrl: this.baseUrl, log: opts.log });
		this.rpcIdFactory =
			opts.rpcIdFactory ?? (() => crypto.randomUUID());
		this.backoff = opts.backoffScheduleMs ?? [1000, 2000, 5000, 10000, 30000];
		// Wire-derived default (not a deployment tunable): the host queues a
		// new generation's still-pending replay around its ready frame, so a
		// short drain of slack covers the ordering; only tests shrink it.
		this.answerReapGraceMs = opts.answerReapGraceMs ?? 3000;
		this.staleGenerationRetryMs = opts.staleGenerationRetryMs ?? 5000;
		this.log = opts.log ?? (() => {});
	}

	// ── Generation lifecycle ─────────────────────────────────────────────

	/**
	 * Open the stream generation (idempotent): ONE cookie-authenticated
	 * remote.mux socket (0.1.2 — events.mux/events.host are gone), with every
	 * subscribed session's `session/follow` reopened as a logical stream plus
	 * the $events forwarded-event stream (approvals/questions).
	 */
	ensureDownlinks(): void {
		if (this.disposed || this.wsMux) return;
		++this.generation;
		this.log(`dsh-connection: opening remote.mux generation ${this.generation}`);
		// Socket construction is synchronous (the cookie header attaches from
		// the auth carrier at construction; no token configured → undefined,
		// unauthenticated hosts never fence). A later 401/close re-mints.
		this.wsMux = this.openDownlink((socket) => this.onMuxOpen(socket));
		void this.seedRunning();
	}

	private openDownlink(attach: (socket: WebSocketLike) => void): WebSocketLike {
		const url = this.baseUrl.replace(/^http/, 'ws') + DSH_REMOTE_MUX_WS_PATH;
		const headers = this.auth.cookieHeader();
		const socket = this.wsFactory(url, headers === undefined ? undefined : { cookie: headers });
		void this.auth.ensureCookie().catch(() => null);
		socket.addEventListener('message', (e) => {
			try {
				// remote.mux carries RAW RemoteStreamServerMessage frames
				// ({item,end,error,streamId}) — no server-request envelope.
				this.onStreamFrame(JSON.parse(String(e.data)));
			} catch (err) {
				this.log('dsh-connection: dropping malformed frame', err);
			}
		});
		socket.addEventListener('open', () => {
			this.opened = true;
			attach(socket);
		});
		socket.addEventListener('close', () => this.onDownlinkClosed());
		socket.addEventListener('error', () => this.onDownlinkClosed());
		return socket;
	}

	/** mux open: (re)open every subscribed session's follow stream + $events. */
	private onMuxOpen(socket: WebSocketLike): void {
		this.streamSeq += 1;
		this.pendingSubscribes.clear();
		// openFollowWithProbe picks each session's current address: a folded
		// subagent hint rides the rebuild; plain sessions keep the plain form.
		for (const sessionId of this.buffers.keys()) this.openFollowWithProbe(socket, sessionId);
		this.openEventStream(socket);
		this.openStateStream(socket, `workspaces-${String(this.streamSeq)}`, 'workspace/follow');
		this.openStateStream(socket, `control-${String(this.streamSeq)}`, 'session/control');
	}

	/** Open one state stream (workspace/follow | session/control) with empty args. */
	private openStateStream(socket: WebSocketLike, streamId: string, endpoint: string): void {
		this.sendStreamOpen(socket, streamId, endpoint, { args: {} });
	}

	private openFollowStream(socket: WebSocketLike, sessionId: string): void {
		this.sendStreamOpen(socket, followStreamId(sessionId, this.streamSeq), 'session/follow', {
			args: {
				request: {
					address: this.addressFor(sessionId),
					maxMessages: 200,
					// 0.1.3-alpha.1: opt into the host's live assistant-stream
					// channel — ledger v2 removed the durable assistant/chunk
					// events, so without the opt-in a streaming turn shows
					// nothing until the durable assistant/message lands.
					assistantStream: true
				}
			}
		});
	}

	private openEventStream(socket: WebSocketLike): void {
		this.sendStreamOpen(
			socket,
			`events-${String(this.streamSeq)}`,
			REMOTE_EVENT_STREAM_ENDPOINT,
			REMOTE_EVENT_STREAM_PAYLOAD
		);
	}

	private sendStreamOpen(socket: WebSocketLike, streamId: string, endpoint: string, payload: unknown): void {
		const send = (msg: string) => socket.send?.(msg);
		this.streamSockets.set(streamId, socket);
		send(JSON.stringify({ type: 'open', streamId, endpoint, payload }));
	}

	/** Either socket dying rebuilds the whole generation (guide Part 1). */
	private onDownlinkClosed(): void {
		if (this.disposed) return;
		if (!this.wsMux) return;
		this.log('dsh-connection: remote.mux died — rebuilding generation');
		// Slash Menu W1 (task 1.3): a mux reset may have missed catalog
		// frames — drop every cached catalog alongside the rebuild (the
		// existing reset path; PRD §5 invalidation table).
		this.fireCatalogInvalidated('all');
		this.teardownSockets();
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		if (this.disposed) return;
		// Ladder ascends on consecutive failed generations (Wave 4.2): each
		// teardown climbs one rung (capped); a delivered mux frame resets it.
		// A repeated schedule within one teardown keeps the already-climbed rung.
		const rung = Math.min(this.reconnectAttempt, this.backoff.length - 1);
		const delay = this.backoff[rung];
		if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = setTimeout(() => {
			if (this.disposed) return;
			this.reconnectAttempt += 1; // next drop (if this generation fails) waits longer
			this.ensureDownlinks();
		}, delay);
	}

	private teardownSockets(): void {
		// Detach BEFORE closing: a refused/failed undici WebSocket dispatches
		// `close` synchronously inside close() (and again on every re-entrant
		// close()), re-entering onDownlinkClosed. Fields already undefined →
		// the guard returns instead of recursing (2026-08-29 startup crash).
		const sockets = [this.wsMux];
		this.wsMux = undefined;
		this.opened = false;
		this.streamSockets.clear();
		this.projections.clear();
		this.workspaces = [];
		for (const waiter of this.workspaceBaselineWaiters) waiter.resolve();
		this.workspaceBaselineWaiters.clear();
		if (this.reconnectTimer !== undefined) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		for (const socket of sockets) socket?.close();
	}

	// ── Frame dispatch ───────────────────────────────────────────────────

	/**
	 * 0.1.2 remote.mux demux: `{item,end,error,streamId}` frames. Follow
	 * streams deliver a `snapshot` opening (seeds the baseline) then event
	 * entries (ring buffer appends); the $events stream delivers forwarded
	 * Cordis events (approval/question waterfalls → answerer registry).
	 */
	private onStreamFrame(payload: unknown): void {
		const frame = payload as {
			type: 'item' | 'end' | 'error';
			streamId?: string;
			value?: unknown;
			error?: { code?: string; message?: string };
		};
		if (typeof frame?.streamId !== 'string') return;
		if (frame.type === 'item' && frame.value !== undefined) {
			this.reconnectAttempt = 0;
			const value = frame.value as Record<string, unknown>;
			if (frame.streamId.startsWith('follow-')) {
				this.onFollowItem(frame.streamId, value);
			} else if (frame.streamId.startsWith('events-')) {
				this.onEventItem(value);
			} else if (frame.streamId.startsWith('workspaces-')) {
				this.onWorkspaceItem(value);
			} else if (frame.streamId.startsWith('control-')) {
				this.onControlItem(value);
			}
			return;
		}
		if (frame.type === 'error') {
			this.log(
				`dsh-connection: stream ${frame.streamId} failed`,
				frame.error?.code,
				frame.error?.message
			);
		}
		this.streamSockets.delete(frame.streamId);
	}

	/** session/follow item: snapshot seeds the baseline; events append; the
	 *  opted-in assistant-stream frames update the live tail (seq-less —
	 *  they never touch the durable cursor bookkeeping below). */
	private onFollowItem(streamId: string, value: Record<string, unknown>): void {
		if (value.type === 'snapshot') {
			const sessionId = this.sessionIdOfStream(streamId);
			if (sessionId === null) return;
			const snapshot = value as unknown as {
				cursor: number;
				records: Array<{ type: string; event?: DshSessionEventLike }>;
				projections?: RawSessionProjections;
				assistantStream?: SessionAssistantStreamBaselineLike;
			};
			// Records first (empty buffer accepts every seq), then the cursor
			// seeds lastSeq ABOVE the last appended seq — the cursor is the
			// follow's authoritative position and is always ≥ the last event
			// seq on v2 hosts.
			const events = expandRecords(snapshot.records ?? []);
			for (const event of events) this.appendEvent(sessionId, event);
			this.seedSnapshotCursor(sessionId, snapshot.cursor);
			if (snapshot.projections !== null && typeof snapshot.projections === 'object') {
				this.projections.set(sessionId, snapshot.projections as RawSessionProjections);
			}
			this.seedLiveTailFromBaseline(sessionId, snapshot.assistantStream);
			return;
		}
		if (value.type === 'assistant-stream') {
			const sessionId = this.sessionIdOfStream(streamId);
			const frame = value.frame as SessionAssistantStreamFrameLike | undefined;
			if (sessionId !== null && frame !== undefined) {
				this.onAssistantStreamFrame(sessionId, frame);
			}
			return;
		}
		if (value.type === 'event') {
			const sessionId = this.sessionIdOfStream(streamId);
			const entry = value as { event?: DshSessionEventLike };
			if (sessionId !== null && entry.event !== undefined) {
				for (const event of expandEntry(entry.event)) this.appendEvent(sessionId, event);
			}
		}
	}

	/** $events item: forwarded Cordis event frames (waterfall = answerable). */
	private onEventItem(value: Record<string, unknown>): void {
		if (value.type === 'ready') {
			// clientId binds every later $events/result answer to this
			// generation (stream-protocol RemoteEventReadyFrame).
			if (typeof value.clientId === 'string') this.eventClientId = value.clientId;
			this.log('dsh-connection: $events stream ready');
			this.armAnswerReap();
			return;
		}
		if (value.type === 'waterfall') {
			// 0.1.2 answer surface (W2): approval/question waterfalls keyed by
			// eventId; agentId IS the sessionId (request carries no agent —
			// projectRemoteEventRequest strips it); answered via $events/result.
			const event = typeof value.event === 'string' ? value.event : '';
			const eventId = typeof value.eventId === 'string' ? value.eventId : undefined;
			const sessionId = typeof value.agentId === 'string' ? value.agentId : undefined;
			const request =
				value.request !== null && typeof value.request === 'object'
					? (value.request as Record<string, unknown>)
					: {};
			if (eventId === undefined) return;
			if (event === 'approval/request') {
				this.registerPending(
					{ type: 'approval/requested', sessionId: sessionId ?? '', ...request },
					eventId
				);
				return;
			}
			if (event === 'user-questions/request') {
				this.registerPending(
					{ type: 'question/requested', sessionId: sessionId ?? '', ...request },
					eventId
				);
				return;
			}
			this.log('dsh-connection: forwarded waterfall ignored', event);
			return;
		}
		if (value.type === 'cancel') {
			const eventId = typeof value.eventId === 'string' ? value.eventId : undefined;
			if (eventId !== undefined) this.withdrawPending(eventId);
			this.log('dsh-connection: forwarded waterfall cancelled');
			return;
		}
		if (value.type === 'settle') {
			// Host-side settlement (answered elsewhere / resolved): withdraw the
			// card and record the outcome in the settlement ring.
			const eventId = typeof value.eventId === 'string' ? value.eventId : undefined;
			const outcome = typeof value.outcome === 'string' ? value.outcome : 'unknown';
			if (eventId !== undefined) this.withdrawPending(eventId, outcome);
			return;
		}
		if (value.type === 'emit') {
			// api-session/status carries positional args [sessionId, running].
			if (value.event === 'api-session/status' && Array.isArray(value.args)) {
				const [sessionId, running] = value.args;
				if (typeof sessionId === 'string') this.running.set(sessionId, running === true);
				return;
			}
			// Slash Menu W1 (task 1.3) — the catalog invalidation arms: the
			// host's own menu refreshes on the same two frames (PRD §1 fact 6;
			// both sit in the forwarding allowlist and ALREADY arrive here —
			// previously dropped by the ignore fall-through below).
			if (value.event === 'commands/change') {
				// Any session's command vocabulary moved — drop every catalog.
				this.fireCatalogInvalidated('all');
				return;
			}
			if (value.event === 'agent-preset/selected' && typeof value.agentId === 'string') {
				// Preset switch retargets ONE session — drop only its catalog
				// (skills/list reads the preset's registry at request time).
				this.fireCatalogInvalidated(value.agentId);
				return;
			}
			this.log('dsh-connection: forwarded emit ignored', value.event);
			return;
			}
	}

	/**
	 * workspace/follow item (W2): baseline replaces the cache; increments
	 * apply in order (upsert/remove/order/archived — archived sessions are
	 * hidden from DSI's surfaces the same way the 0.1.1 registry did).
	 */
	private onWorkspaceItem(value: Record<string, unknown>): void {
		if (value.type === 'baseline') {
			const baseline = (value.value ?? {}) as { items?: unknown };
			const rows = Array.isArray(baseline.items) ? baseline.items : [];
			this.workspaces = rows.flatMap((row): DsiWorkspaceSummary[] => {
				const w = row as { workspaceId?: unknown; title?: unknown; path?: unknown; sessionIds?: unknown };
				if (typeof w?.workspaceId !== 'string' || typeof w?.path !== 'string') return [];
				return [{
					workspaceId: w.workspaceId,
					title: typeof w.title === 'string' && w.title.length > 0 ? w.title : w.path,
					path: w.path,
					sessionIds: Array.isArray(w.sessionIds) ? w.sessionIds.filter((id): id is string => typeof id === 'string') : []
				}];
			});
			for (const waiter of this.workspaceBaselineWaiters) waiter.resolve();
			this.workspaceBaselineWaiters.clear();
			this.log(`dsh-connection: workspace baseline (${this.workspaces.length} rows)`);
			return;
		}
		if (value.type === 'upsert') {
			const w = value.workspace as { workspaceId?: unknown; title?: unknown; path?: unknown; sessionIds?: unknown } | undefined;
			if (typeof w?.workspaceId !== 'string' || typeof w?.path !== 'string') return;
			const row: DsiWorkspaceSummary = {
				workspaceId: w.workspaceId,
				title: typeof w.title === 'string' && w.title.length > 0 ? w.title : w.path,
				path: w.path,
				sessionIds: Array.isArray(w.sessionIds) ? w.sessionIds.filter((id): id is string => typeof id === 'string') : []
			};
			const idx = this.workspaces.findIndex((x) => x.workspaceId === row.workspaceId);
			if (idx >= 0) this.workspaces.splice(idx, 1, row);
			else this.workspaces.push(row);
			return;
		}
		if (value.type === 'remove' && typeof value.workspaceId === 'string') {
			this.workspaces = this.workspaces.filter((x) => x.workspaceId !== value.workspaceId);
			return;
		}
		// order / archived: order is host-owned presentation; archived sessions
		// are not workspace members on this surface — the list stays as-is.
	}

	/**
	 * session/control item (W2): the baseline's per-session projections seed
	 * the store (permissions for the access chip); later projection frames
	 * update single keys. queue/job frames are not DSI state (ignored).
	 */
	private onControlItem(value: Record<string, unknown>): void {
		if (value.type === 'baseline') {
			const baseline = (value.value ?? {}) as {
				projections?: Record<string, RawSessionProjections>;
			};
			for (const [sessionId, block] of Object.entries(baseline.projections ?? {})) {
				if (block !== null && typeof block === 'object') this.projections.set(sessionId, block);
			}
			this.log(`dsh-connection: control baseline (${this.projections.size} sessions)`);
			return;
		}
		if (value.type === 'projection' && typeof value.sessionId === 'string' && typeof value.key === 'string') {
			const block = this.projections.get(value.sessionId) ?? { asOfSeq: 0, values: {} };
			this.projections.set(value.sessionId, {
				asOfSeq: typeof value.seq === 'number' ? value.seq : block.asOfSeq,
				values: { ...block.values, [value.key]: value.value }
			});
		}
	}

	/** Extract the sessionId from a follow-<sessionId>-<seq> stream id. */
	private sessionIdOfStream(streamId: string): string | null {
		// follow-<sessionId>-<streamSeq>
		const rest = streamId.slice('follow-'.length);
		const cut = rest.lastIndexOf('-');
		return cut > 0 ? rest.slice(0, cut) : null;
	}	/**
	 * POC-3 W1 — answerable frames arrive as ServerRequest pushes with a
	 * stable rpcId. Mux-open REPLAYS still-pending requested frames with the
	 * same rpcId (api-proxy.ts replay loop), so the registry must be
	 * idempotent by rpcId (BC-C): a replay overwrites, never duplicates.
	 */
	private pendingAnswers = new Map<string, PendingAnswerFrame>();
	/** Settlement ring: last outcome per rpcId, delivered-then-pruned. */
	private settledAnswers = new Map<string, AnswerSettlement>();

	/** Catalog-invalidation registry (Slash Menu W1) — listeners see every arm. */
	private catalogInvalidated: Set<CatalogInvalidationListener> = new Set();

	/** Subscribe to catalog invalidations ($events arms + socket reset). */
	onCatalogInvalidated(listener: CatalogInvalidationListener): () => void {
		this.catalogInvalidated.add(listener);
		return () => this.catalogInvalidated.delete(listener);
		}

	private fireCatalogInvalidated(scope: string | 'all'): void {
		for (const listener of this.catalogInvalidated) listener(scope);
	}

	private onMuxFrame(payload: unknown, rpcId?: string): void {
		// A delivered mux frame proves the generation is alive: the next drop
		// starts over at the first backoff rung.
		this.reconnectAttempt = 0;
		const frame = payload as {
			type: string;
			sessionId?: string;
			lastSeq?: number;
			event?: DshSessionEvent;
		};
		switch (frame?.type) {
			case 'session/subscribed':
				if (typeof frame.sessionId === 'string') {
					this.seedBaseline(frame.sessionId, frame.lastSeq ?? -1);
				}
				return;
			case 'session/event':
				if (frame.sessionId && frame.event) {
					this.appendEvent(frame.sessionId, frame.event);
				}
				return;
			case 'approval/requested':
			case 'question/requested':
				this.registerPending(frame, rpcId);
				return;
			case 'approval/resolved':
			case 'question/resolved':
				this.registerSettlement(frame);
				return;
			default:
				// queue/jobs/projection/… — not ring-buffer state; ignored here
				this.log('dsh-connection: mux frame ignored', frame?.type);
		}
	}

	private onHostFrame(payload: unknown): void {
		const frame = payload as { type: string; sessionId?: string; running?: boolean };
		if (frame?.type === 'host/session-status' && typeof frame.sessionId === 'string') {
			this.runningSeedRaces.add(frame.sessionId);
			this.running.set(frame.sessionId, Boolean(frame.running));
		}
	}

	/**
	 * 2026-08-26 running re-baseline: DSH pushes host/session-status only on
	 * transitions and the host stream sends no initial snapshot on (re)open —
	 * a downlink rebuilt mid-turn never sees the running:true flip that
	 * happened before it existed (the live bug: events kept flowing on the
	 * mux while the streaming indicator said idle). session.list is the host's
	 * documented reconnect baseline, so every generation opens with ONE list
	 * RPC seeding the whole map — which also prunes entries for sessions that
	 * died while disconnected. Pushes that land while the RPC is in flight win
	 * over the snapshot (they are strictly newer transitions); a seed from a
	 * superseded generation is dropped entirely.
	 */
	private async seedRunning(): Promise<void> {
		const generation = this.generation;
		this.runningSeedRaces = new Set();
		try {
			const { items } = await this.listSessions();
			if (this.disposed || generation !== this.generation) return;
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

	// ── Ring buffer ──────────────────────────────────────────────────────

	private bufferFor(sessionId: string): SessionBuffer {
		let buf = this.buffers.get(sessionId);
		if (!buf) {
			buf = { entries: [], lastSeq: -1, coverageFloor: -1 };
			this.buffers.set(sessionId, buf);
		}
		return buf;
	}

	private seedBaseline(sessionId: string, lastSeq: number): void {
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

	/**
	 * Snapshot cursor seed (0.1.2). A snapshot BELOW the buffered high-water
	 * mark means the upstream was rebuilt (stream restart): stale entries
	 * belong to the dead instance — reset the buffer to the snapshot truth
	 * (Wave 2 parity with the 0.1.1 rewound-baseline semantics).
	 */
	private seedSnapshotCursor(sessionId: string, cursor: number): void {
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

	private appendEvent(sessionId: string, event: DshSessionEvent): void {
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
			const cap = ringCapacity();
			if (buf.entries.length > cap) {
				buf.entries.splice(0, buf.entries.length - cap);
			}
		}
	}

	// ── Live assistant-stream tail (0.1.3-alpha.1) ───────────────────────

	/**
	 * Fold one assistant-stream frame into the session's live tail. Seq-less
	 * presentation state: never touches lastSeq/coverage — the durable
	 * cursor algebra stays event-entry-only. The host keeps ONE active
	 * attempt per session and drops its own accumulator on any continuity
	 * break (foreign attemptId, dense-index gap), so mirrors do the same.
	 */
	private onAssistantStreamFrame(sessionId: string, frame: SessionAssistantStreamFrameLike): void {
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

	/**
	 * Seed the live tail from a follow-opening snapshot's assistantStream
	 * baseline (mux-drop reopen mid-attempt): expand the compact stream
	 * records' text/reasoning runs into the tail. No activeAttempt → clear
	 * any remembered tail — the fresh opening is authoritative for what is
	 * still in flight.
	 */
	private seedLiveTailFromBaseline(
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

	/**
	 * The session's live tail for the events poll, or null when no attempt
	 * is in flight. Served with the FULL accumulated text each poll — the
	 * client replaces its streaming bubble wholesale (no cross-poll fragment
	 * bookkeeping, so reconnects/retries converge from the served truth).
	 */
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

	// ── Public read API (used by api-dsh routes) ────────────────────────

	/**
	 * Delta slice: events with seq > n, plus current lastSeq/running.
	 * Wave 4.2: `gap` is true when the caller's `since` mark fell into a hole
	 * the buffer no longer covers (mux drop). The response then carries the
	 * resync flag so the client re-reads from the ledger instead of trusting
	 * a partial delta (BC-4).
	 */
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

	/**
	 * Subscribe one session (0.1.2): create its buffer and open a
	 * session/follow logical stream on the live carrier (or mark it for the
	 * next generation). Idempotent; the snapshot frame seeds the baseline.
	 * A repeat call while THIS generation already holds the session's follow
	 * stream is a no-op — the api-dsh events route calls subscribe on every
	 * poll, and reopening would replace the stream (same streamId → fresh
	 * snapshot) on every tick. A stream 'end'/'error' frame drops the
	 * tracking entry so the next poll reopens and self-heals.
	 */
	subscribe(sessionId: string): void {
		this.bufferFor(sessionId);
		const socket = this.wsMux;
		// CONNECTING sockets cannot send (undici throws Sent-before-connected):
		// park the id; onMuxOpen opens every subscribed buffer's stream anyway.
		if (socket === undefined) return;
		if (this.opened === false) {
			this.pendingSubscribes.add(sessionId);
			return;
		}
		if (this.streamSockets.has(followStreamId(sessionId, this.streamSeq))) return;
		this.openFollowWithProbe(socket, sessionId);
	}

	/**
	 * Open the follow stream with the best-known address NOW (sync, the
	 * historical contract), then — when this turns out to be a subagent child
	 * nobody has folded yet — probe and REOPEN with the parent address (the
	 * mux replaces a stream id; the fresh snapshot reseeds the baseline).
	 */
	private openFollowWithProbe(socket: WebSocketLike, sessionId: string): void {
		this.openFollowStream(socket, sessionId);
		if (!this.subagentHints.has(sessionId) && !this.hintProbed.has(sessionId)) {
			this.hintProbed.add(sessionId);
			void this.probeHintThenSubscribe(sessionId, socket);
		}
	}

	/** Resolve one session's address hint after a plain-form follow went out;
	 *  on a folded hint REOPEN the follow with the parent address (a plain
	 *  form on a subagent child is rejected by the host and the stream would
	 *  stay dead for the whole generation). Skipped when the carrier moved on
	 *  (generation rebuilt / disposed) during the list RPC — onMuxOpen
	 *  reopens every buffer with the then-current addresses. */
	private async probeHintThenSubscribe(sessionId: string, socket: WebSocketLike): Promise<void> {
		try {
			if (!this.subagentHints.has(sessionId)) await this.rawListSessions();
		} catch {
			// The probe is best-effort: the next list pass (re-baseline, any
			// page call) folds the row; until then the plain form stays out.
		}
		if (this.disposed || this.wsMux !== socket || this.opened === false) return;
		if (this.subagentHints.has(sessionId)) this.openFollowStream(socket, sessionId);
	}

	/**
	 * Per-session projection value (W2): follow-snapshot + control-baseline
	 * + control projection frames, newest wins. permissions (access chip),
	 * modelSelection, todos, plan … — null when never seen.
	 */
	projectionValue(sessionId: string, key: string): unknown {
		return this.projections.get(sessionId)?.values?.[key];
	}

	/** The whole stored block for one session (null when absent). */
	projectionBlock(sessionId: string): RawSessionProjections | null {
		return this.projections.get(sessionId) ?? null;
	}

	/**
	 * Bounded wait for the session's FIRST projection baseline (0.1.2 cold
	 * loads seed the access mode + admission numbers from the follow/control
	 * store — session/page carries no projections block). Resolves
	 * immediately when a block exists; null after timeoutMs (an unfenced or
	 * slow host degrades to the documented defaults, never a hang).
	 */
	async waitForProjections(sessionId: string, timeoutMs = 2_500): Promise<RawSessionProjections | null> {
		this.ensureDownlinks();
		this.subscribe(sessionId);
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const block = this.projectionBlock(sessionId);
			if (block !== null) return block;
			if (Date.now() >= deadline) return null;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	/**
	 * True once the workspace/follow baseline landed. Registers the waiter
	 * even while the carrier is CONNECTING (the first RPC often races the
	 * handshake); bounded by 3s — an honest empty after that, never a hang.
	 */
	private async awaitWorkspaceBaseline(): Promise<boolean> {
		if (this.workspaces.length > 0) return true;
		this.ensureDownlinks();
		if (this.wsMux === undefined) return false;
		const waiter: PromiseWithResolvers<void> = Promise.withResolvers();
		this.workspaceBaselineWaiters.add(waiter);
		await Promise.race([waiter.promise, new Promise((r) => setTimeout(r, 3000))]);
		this.workspaceBaselineWaiters.delete(waiter);
		return this.workspaces.length > 0;
	}

	/** True when the session has a live baseline (subscribed at least once). */
	hasBaseline(sessionId: string): boolean {
		return this.buffers.has(sessionId) && this.bufferFor(sessionId).lastSeq >= 0;
	}

	isRunning(sessionId: string): boolean {
		return this.running.get(sessionId) ?? false;
	}

	// ── Pending-answer registry (POC-3 W1 — BC-C idempotent by rpcId) ────

	/** approval/requested | question/requested → registry (idempotent by rpcId). */
	private registerPending(frame: Record<string, unknown>, rpcId?: string): void {
		const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : '';
		if (!sessionId) {
			// Orphan frame (no session context) — log and ignore; never crash the poll path.
			this.log('dsh-connection: answerable frame without sessionId — ignored', frame?.type);
			return;
		}
		if (typeof rpcId !== 'string' || rpcId.length === 0) {
			this.log('dsh-connection: answerable frame without rpcId — ignored', frame?.type);
			return;
		}
		const kind = frame.type === 'approval/requested' ? 'approval' : 'question';
		// Idempotent: mux-open replay re-delivers the SAME rpcId — set (replace)
		// never duplicates; receivedAt refreshes on replay (host says: still pending).
		this.pendingAnswers.set(rpcId, {
			rpcId,
			sessionId,
			kind,
			body: frame as Record<string, unknown>,
			receivedAt: Date.now(),
			deliveredGen: this.generation
		});
		this.log(`dsh-connection: pending ${kind} registered (${rpcId}) for ${sessionId}`);
	}

	/**
	 * Withdraw one pending answer (0.1.2 $events settle/cancel): remove the
	 * registry entry and record the outcome in the settlement ring. Unknown
	 * ids settle nothing (answered before we subscribed — honest no-op).
	 */
	private withdrawPending(eventId: string, outcome?: string): void {
		const pending = this.pendingAnswers.get(eventId);
		if (pending === undefined) {
			this.log(`dsh-connection: settlement with no matching pending (${eventId}) — ignored`);
			return;
		}
		this.pendingAnswers.delete(eventId);
		this.settledAnswers.set(eventId, {
			rpcId: eventId,
			sessionId: pending.sessionId,
			kind: pending.kind,
			outcome: outcome ?? 'cancelled',
			settledAt: Date.now()
		});
		this.log(`dsh-connection: ${pending.kind} settled (${eventId}) outcome=${outcome ?? 'cancelled'}`);
	}

	/**
	 * Schedule the still-pending replay reap for this generation (ready
	 * frame just arrived). The host replays every still-pending waterfall
	 * into the new generation, but the ready frame can hit the wire before
	 * the replayed frames drain, so the check runs after a short grace —
	 * entries an older generation registered and the replay did NOT
	 * re-confirm finished while we were disconnected (answered, cancelled,
	 * or aborted); keeping them pending resurrects zombie answer cards the
	 * user can answer forever with no effect.
	 */
	private armAnswerReap(): void {
		clearTimeout(this.answerReapTimer);
		this.answerReapTimer = setTimeout(() => this.reapUnconfirmedPending(), this.answerReapGraceMs);
	}

	/** Withdraw every pending answer not re-delivered by the current generation. */
	private reapUnconfirmedPending(): void {
		for (const [eventId, pending] of [...this.pendingAnswers]) {
			if (pending.deliveredGen >= this.generation) continue;
			this.log(
				`dsh-connection: reap unconfirmed pending (${eventId}) from generation ${pending.deliveredGen} — not in generation ${this.generation} replay`
			);
			this.withdrawPending(eventId);
		}
	}

	/**
	 * After OUR answer was accepted the question is done — withdraw the
	 * registry entry with the outcome we sent instead of waiting for the
	 * host's settle broadcast, which races generation rebuilds and can be
	 * lost entirely (the answered card would resurrect on the next page
	 * load from a stale pendingAnswers).
	 */
	private forgetAnswered(rpcId: string, value: unknown): void {
		this.withdrawPending(rpcId, typeof value === 'string' ? value : 'answered');
	}

	/** approval/resolved | question/resolved → pending removed, settlement recorded. */
	private registerSettlement(frame: Record<string, unknown>): void {
		const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : '';
		if (!sessionId) {
			this.log('dsh-connection: settlement frame without sessionId — ignored', frame?.type);
			return;
		}
		// approval/resolved keys by approvalId; question/resolved by questionRpcId —
		// both resolve back to the pending entry's rpcId via the registry.
		const kind = frame.type === 'approval/resolved' ? 'approval' : 'question';
		const outcome = typeof frame.outcome === 'string' ? frame.outcome : 'unknown';
		let rpcId: string | undefined;
		if (kind === 'approval' && typeof frame.approvalId === 'string') {
			rpcId = [...this.pendingAnswers.values()].find(
				(p) => p.sessionId === sessionId && p.body.approvalId === frame.approvalId
			)?.rpcId;
		} else if (kind === 'question' && typeof frame.questionRpcId === 'string') {
			// question/resolved names the ORIGINAL request's rpcId (api-proxy claimQuestion).
			rpcId = frame.questionRpcId;
		}
		if (rpcId) {
			this.pendingAnswers.delete(rpcId);
			this.settledAnswers.set(rpcId, {
				rpcId,
				sessionId,
				kind,
				outcome,
				settledAt: Date.now()
			});
			this.log(`dsh-connection: ${kind} settled (${rpcId}) outcome=${outcome}`);
		} else {
			// Settlement for an unknown/foreign request (e.g. answered before we
			// subscribed, or another UI raced) — nothing pending to withdraw.
			this.log(`dsh-connection: settlement with no matching pending (${frame?.type}) — ignored`);
		}
	}

	/** Pending answers for a session (for the PollResponse extension). */
	pendingFor(sessionId: string): PendingAnswerFrame[] {
		return [...this.pendingAnswers.values()].filter((p) => p.sessionId === sessionId);
	}

	/** Recent settlements for a session (ring: delivered-then-pruned). */
	settlementsFor(sessionId: string): AnswerSettlement[] {
		return [...this.settledAnswers.values()].filter((s) => s.sessionId === sessionId);
	}

	/** Delivery hook: drop settlements the client has already seen (ring prune). */
	pruneSettlements(sessionId: string, seenRpcIds: string[]): void {
		for (const id of seenRpcIds) {
			const s = this.settledAnswers.get(id);
			if (s && s.sessionId === sessionId) this.settledAnswers.delete(id);
		}
	}

	// ── RPC forwards (all bytes via dsh-rpc helpers) ─────────────────────

	/**
	 * Fork-child display titles healed off the wire (2026-09-14, host gap
	 * DSI-side): the host's session.list serves NO projections column for a
	 * cold seeded (fork child) row — session-controller list.ts
	 * projectionsFor short-circuits isSeeded headers because the projection
	 * cache is keyed by the inherited cut a listed header does not carry.
	 * The real title (what the panel shows once the session attaches) lives
	 * in the child's ledger: a child that ran its own turns carries a NEW
	 * session/title event near the tail, so ONE bounded tail-page read per
	 * untitled fork row recovers it. The result caches for the process
	 * lifetime (a retitle lands through the normal rename/live paths, which
	 * serve the title directly). The parent row's title is the FALLBACK for
	 * children the tail page shows never retitled — the inherited title IS
	 * the parent's at fork time; stale only when the parent was renamed
	 * after the fork. Absent hints and absent parents leave the row
	 * honestly untitled.
	 */
	private forkTitleHints = new Map<string, string>();
	private forkTitleInFlight = new Set<string>();

	async listSessions(): Promise<ListResult> {
		const items = (await this.rawListSessions()).map(normalizeSessionRow);
		const titleById = new Map(items.map((s) => [s.sessionId, s.title] as const));
		for (const row of items) {
			if (row.title !== null) continue;
			if (row.parentSessionId === null || row.origin === 'subagent') continue;
			const hint = this.forkTitleHints.get(row.sessionId);
			if (hint !== undefined) {
				row.title = hint;
				continue;
			}
			if (!this.forkTitleInFlight.has(row.sessionId)) {
				this.forkTitleInFlight.add(row.sessionId);
				void this.healForkTitle(row.sessionId);
			}
			const parentTitle = titleById.get(row.parentSessionId);
			if (typeof parentTitle === 'string' && parentTitle.length > 0) row.title = parentTitle;
		}
		return { items };
	}

	/**
	 * The child's REAL title via its follow snapshot (2026-09-14): opening
	 * the session/follow stream makes the host read the child's FULL ledger
	 * and answer a snapshot whose projections block carries the folded
	 * title — exactly what the panel shows once the session attaches. This
	 * deliberately replaces an earlier session/page walk: paginate's window
	 * is min(throughSeq+1, beforeSeq) and throughSeq -1 names NO seq, so
	 * every page combination for a cold child whose cursor is unknown comes
	 * back empty — the page RPC simply cannot serve this read without a
	 * known through seq. Subscribing is heavier than one unary call but
	 * bounded (ring capacity per child) and idempotent with every other
	 * follow consumer. Fail-soft: any failure leaves the row on the parent
	 * fallback.
	 */
	private async healForkTitle(sessionId: string): Promise<void> {
		try {
			const block = await this.waitForProjections(sessionId);
			const title = block?.values?.['title'];
			if (typeof title === 'string' && title.length > 0) this.forkTitleHints.set(sessionId, title);
		} catch (error) {
			this.log('dsh-connection: fork-title follow-baseline read failed for ' + sessionId, error);
		} finally {
			this.forkTitleInFlight.delete(sessionId);
		}
	}

	/**
	 * The workspace-RPC OWNER for a session (2026-09-10): the host keys
	 * workspaceFiles by the OWNING agent session and refuses sub-agent ids
	 * (session/not-found / agent-busy — a sub-agent session is not an RPC
	 * address). A sub-agent's workspace IS its root ancestor's, so walk the
	 * parentSessionId chain (session.list) to the root; a root session
	 * resolves to itself. Cycles guard themselves.
	 */
	async workspaceOwnerSessionId(sessionId: string): Promise<string> {
		const { items } = await this.listSessions();
		const parentOf = new Map(
			items.map((s) => [s.sessionId, (s as { parentSessionId?: string | null }).parentSessionId ?? null])
		);
		let cursor = sessionId;
		const seen = new Set<string>();
		while (!seen.has(cursor)) {
			seen.add(cursor);
			const parent = parentOf.get(cursor);
			if (!parent || parent === cursor) break;
			cursor = parent;
		}
		return cursor;
	}


	/** Raw session/list rows (0.1.2) — projections.asOfSeq drives page calls. */
	private async rawListSessions(): Promise<RawSessionRow[]> {
		const raw = (await this.rpc(DSH_METHODS.list, DSH_ARGS.list())) as { items?: RawSessionRow[] };
		const rows = Array.isArray(raw?.items) ? raw.items : [];
		for (const row of rows) this.foldSubagentHint(row);
		return rows;
	}

	/**
	 * Fold one list row's subagent identity into the hint cache. Only rows
	 * the host stamps `origin:'subagent'` with a readable parent and a
	 * descriptor lifecycle mode land here; a half-readable row keeps no hint
	 * so the host's own rejection (surfaced honestly downstream) names the
	 * truth instead of DSI guessing a mode.
	 */
	private foldSubagentHint(row: RawSessionRow): void {
		if (row.origin !== 'subagent') return;
		if (typeof row.parentSessionId !== 'string' || row.parentSessionId === '') return;
		const identity = row.projections?.values?.['subagent'];
		const mode =
			identity !== null && typeof identity === 'object'
				? (identity as { mode?: unknown }).mode
				: undefined;
		if (mode !== 'one-shot' && mode !== 'continuable') return;
		this.subagentHints.set(row.sessionId, { parentSessionId: row.parentSessionId, mode });
	}

	/**
	 * The session/page + session/follow address for one session id: the
	 * parent-addressed subagent form when a hint is folded, else the plain
	 * session form. Subagent child ids are bare UUIDs (the spawner mints
	 * `SessionId(randomUUID())`) — the id's SHAPE is never a discriminator;
	 * only the host row's origin is.
	 */
	private addressFor(sessionId: string): Record<string, unknown> {
		const hint = this.subagentHints.get(sessionId);
		if (hint === undefined) return { kind: 'session', sessionId };
		return {
			kind: 'subagent',
			parentSessionId: hint.parentSessionId,
			childSessionId: sessionId,
			mode: hint.mode
		};
	}

	/**
	 * The tail-page through-cursor (0.1.2 session/page `throughSeq`). The
	 * list projection's watermark (asOfSeq) is the LOWEST served-projection
	 * row seq (session-projection-cache cachedSnapshot) and FREEZES while no
	 * projection updates — mid-turn it sat at the last projection-relevant
	 * event while the follow stream ran dozens of seqs ahead, so a page cut
	 * there ended below the live truth, rewound the client's mark, and
	 * pinned every later poll into a gap→resync loop. The follow buffer's
	 * cursor IS the host's stream truth (seeded by the host's own snapshot
	 * cursor, advanced only by host events), so a subscribed session pages
	 * through it; the watermark stays the fallback for sessions without a
	 * buffer (never subscribed — the pre-2026-09 behavior).
	 *
	 * A session the list does not name at all, and a listed row whose served
	 * projection carries no cursor, both page with `throughSeq: -1` — the
	 * 0.1.3 wire's unconstrained tail-page form (validated ≥ −1; the page is
	 * bounded by its own cursor, never by ours). The HOST still owns every
	 * refusal: a missing session rejects session/not-found before the cursor
	 * is read (the cold load's 404 branch), never a client-invented error.
	 *
	 * 0.1.3-alpha.1: cold fork children serve `asOfSeq: -1` (the host's cold
	 * blank-probe left with the v2 list projection) — a negative watermark is
	 * "no served cursor", not "below the ledger head".
	 */
	private async pageCursorFor(sessionId: string): Promise<number> {
		const live = this.bufferFor(sessionId).lastSeq;
		if (live >= 0) return live;
		const row = (await this.rawListSessions()).find((r) => r.sessionId === sessionId);
		const throughSeq = row?.projections?.asOfSeq;
		if (typeof throughSeq === 'number' && throughSeq >= 0) return throughSeq;
		return -1;
	}

	/**
	 * session.history successor (0.1.2): the tail page via `session/page`.
	 * throughSeq comes from pageCursorFor: the follow buffer's cursor when
	 * the session has one, else the session/list projections (asOfSeq) of
	 * the same session, else −1 — the 0.1.3 unconstrained tail-page form.
	 */
	async history(sessionId: string): Promise<DshHistoryPage> {
		const throughSeq = await this.pageCursorFor(sessionId);
		return this.pageAsHistory(
			await this.rpc(
				DSH_METHODS.page,
				DSH_ARGS.page({ address: this.addressFor(sessionId), throughSeq })
			)
		);
	}

	/** Workspace registry adoption (2026-08-23, DSH parity): the Add
	 *  workspace button's host call. Raw view passthrough — DSI renders
	 *  only title/path; ordering and session membership stay host-owned. */
	async createWorkspace(path: string): Promise<DshWorkspaceCreateResult> {
		return (await this.rpc(
			DSH_METHODS.workspaceCreate,
			DSH_ARGS.workspaceCreate({ path })
		)) as DshWorkspaceCreateResult;
	}

	/** Workspace rename (Chip Menu ADR D3): {request:{workspaceId,title}}
	 *  → the updated Workspace view. Refusals throw DshRpcError
	 *  (workspace/not-found, workspace/name-conflict). No cache mutation —
	 *  the workspace/follow upsert frame owns the registry (ADR D6). */
	async renameWorkspace(workspaceId: string, title: string): Promise<DshWorkspaceCreateResult> {
		return (await this.rpc(
			DSH_METHODS.workspaceRename,
			DSH_ARGS.workspaceRename(workspaceId, title)
		)) as DshWorkspaceCreateResult;
	}

	/** Workspace delete (Chip Menu ADR D3): {request:{workspaceId}} → the
	 *  removed id. The host removes ONLY the registry row (sessions survive,
	 *  ungrouped); the workspace/follow remove frame owns the registry
	 *  (ADR D6) — no local mutation here. */
	async deleteWorkspace(workspaceId: string): Promise<{ workspaceId: string }> {
		return (await this.rpc(
			DSH_METHODS.workspaceDelete,
			DSH_ARGS.workspaceDelete(workspaceId)
		)) as { workspaceId: string };
	}

	/** Goal Bar (2026-09-08, ADR amendment): one goal mutation through the
	 *  host's Goal Remotes — goals/pause | goals/resume | goals/clear |
	 *  goals/edit with the CAS ref {id, revision} (a stale revision loses
	 *  host-side). goals/edit additionally carries the changed-fields
	 *  request {objective?, maxGoalRounds?} (Goal Editor, 2026-09-09). The
	 *  raw RemoteResult passes through; the route maps refusals. */
	async goalVerb(
		verb: 'pause' | 'resume' | 'clear' | 'edit',
		sessionId: string,
		ref: { id: string; revision: number },
		request?: { objective?: string; maxGoalRounds?: number }
	): Promise<unknown> {
		return this.rpc(
			`goals/${verb}`,
			request === undefined ? { agentId: sessionId, ref } : { agentId: sessionId, ref, request }
		);
	}

	/**
	 * workspaceFiles/read — one page of a UTF-8 text file inside the
	 * session's workspace (Workspace Explorer W2 task 2.1). Flat args
	 * {workspaceFileScopeId, path, range} per the descriptor — NO request
	 * wrapper (scope wire renamed from agentId, host 2026-09-09).
	 * Host refusals (not-found, outside-workspace, too-large, not-text,
	 * not-regular-file) reject as DshRpcError; the route maps the codes.
	 *
	 * @param sessionId - owning session; the host confines the read to its
	 *                    workspace root by containment, never prefix match.
	 * @param path - workspace path, absolute or root-relative.
	 * @param range - line window; omitted fields take the host's page defaults.
	 */
	async readWorkspaceFile(
		sessionId: string,
		path: string,
		range?: { offset?: number; limit?: number }
	): Promise<DshWorkspaceFileText> {
		return (await this.rpc(
			DSH_METHODS.workspaceFileRead,
			DSH_ARGS.workspaceFileRead(sessionId, path, range)
		)) as DshWorkspaceFileText;
	}

	/**
	 * workspaceFiles/readBytes — one byte window of a workspace file, raw
	 * bytes (base64 receipt), no text decoding and no binary refusal
	 * (2026-09-10: binary previews such as images read through this; `read`
	 * refuses them workspace-file/not-text).
	 *
	 * @param sessionId - owning session; the host confines the read to its
				    workspace root by containment.
	 * @param path - workspace path, absolute or root-relative.
	 * @param range - byte window {offset, length}; omitted fields take the
				    host's window defaults.
	 */
	async readWorkspaceFileBytes(
		sessionId: string,
		path: string,
		range?: { offset?: number; length?: number }
	): Promise<DshWorkspaceFileBytes> {
		return (await this.rpc(
			DSH_METHODS.workspaceFileReadBytes,
			DSH_ARGS.workspaceFileReadBytes(sessionId, path, range)
		)) as DshWorkspaceFileBytes;
	}

	/**
	 * workspaceFiles/list — one directory level inside the session's
	 * workspace (Workspace Explorer bugfix 2026-09-09: the picker's
	 * directoryPicker/list is native-only on real hosts — the LIVE tree
	 * lists through this session-authorized namespace instead). Flat args
	 * {workspaceFileScopeId, path}; path is workspace-relative, '' = the root.
	 */
	async listWorkspaceDirectory(sessionId: string, path: string): Promise<DshWorkspaceDirectoryListing> {
		return (await this.rpc(
			DSH_METHODS.workspaceFileList,
			DSH_ARGS.workspaceFileList(sessionId, path)
		)) as DshWorkspaceDirectoryListing;
	}

	/** The workspace registry (2026-08-23 registry parity) — the AUTHORITY
	 *  for DSI's workspace pills/chips: a deleted workspace disappears, and
	 *  sessions outside every registry entry render cue-less (DSH's
	 *  Ungrouped). Membership is sessionIds, not cwd matching. */
	async listWorkspaces(): Promise<{ items: DsiWorkspaceSummary[] }> {
		// W2: workspace/list is gone; the registry read side is the
		// workspace/follow stream baseline (kept live by increments).
		const ok = await this.awaitWorkspaceBaseline();
		if (!ok) {
			this.log('dsh-connection: workspace baseline did not land in time — honest empty');
		}
		return { items: [...this.workspaces] };
	}

	/**
	 * host.listDirectory — one browsed directory level for the Add-workspace
	 * folder picker (DSH parity: the directory-picker browse capability).
	 * Absent path lists the host home directory. Conservative normalize:
	 * garbage rows drop out, never throw, never invent data.
	 */
	async listDirectory(path?: string): Promise<DsiDirectoryListing> {
		const raw = (await this.rpc(DSH_METHODS.listDirectory, DSH_ARGS.listDirectory(path))) as {
			path?: unknown;
			home?: unknown;
			crumbs?: unknown;
			entries?: unknown;
			truncated?: unknown;
		};
		const entry = (v: unknown): DsiDirectoryEntry | null => {
			if (v === null || typeof v !== 'object') return null;
			const e = v as { name?: unknown; path?: unknown; hidden?: unknown };
			if (typeof e.name !== 'string' || typeof e.path !== 'string') return null;
			return { name: e.name, path: e.path, hidden: e.hidden === true };
		};
		const rows = (v: unknown): DsiDirectoryEntry[] =>
			Array.isArray(v)
				? v.flatMap((x) => {
						const e = entry(x);
						return e ? [e] : [];
					})
				: [];
		return {
			path: typeof raw?.path === 'string' ? raw.path : '',
			home: typeof raw?.home === 'string' ? raw.home : '',
			crumbs: rows(raw?.crumbs),
			entries: rows(raw?.entries),
			truncated: raw?.truncated === true
		};
	}

	/**
	 * host.pickDirectory — the NATIVE interaction: the host opens one OS
	 * chooser on its own display and resolves the picked absolute path
	 * (null = operator cancelled). The signal follows the caller — a
	 * disconnected browser closes the host's dialog mid-choice
	 * (api-proxy pickDirectory's carrier contract).
	 */
	/**
	 * Wave 3 (task 3.2) — session.attachment: the session-authorized durable
	 * image read. Returns the ref plus canonical base64 data; host refusals
	 * (unknown id, foreign session) reject as DshRpcError → 502 upstream.
	 *
	 * @param sessionId - owning session (authorization scope).
	 * @param attachmentId - durable content-addressed id from an ImageBlock.
	 */
	async readAttachment(sessionId: string, attachmentId: string): Promise<DshAttachmentValue> {
		return (await this.rpc(
			DSH_METHODS.attachment,
			DSH_ARGS.attachment({ sessionId, attachmentId })
		)) as DshAttachmentValue;
	}

	async pickDirectory(signal?: AbortSignal): Promise<{ path: string | null }> {
		// The wire value IS the picked absolute path (bare string), or null on
		// operator cancel (DirectoryPickerController.pick) — NOT an object
		// carrying it. Reading `.path` off the string answered null for every
		// successful pick, so the panel closed as if the operator had cancelled
		// (2026-09-11 bug: native Add-workspace flow went silently nowhere).
		const raw = (await this.rpc(DSH_METHODS.pickDirectory, DSH_ARGS.pickDirectory(), signal)) as unknown;
		return { path: typeof raw === 'string' && raw.length > 0 ? raw : null };
	}

	/**
	 * POC-2 W3 — session.history PAGE ending at beforeSeq−1 (ledger truth, BC-4).
	 * Live-probed semantics (PRD §1.2): the page covers events with seq <
	 * beforeSeq; hasMore=false at the ledger head. Drives load-older paging —
	 * the ring buffer is freshness-only and never consulted here.
	 */
	async historyPage(sessionId: string, beforeSeq: number): Promise<DshHistoryPage> {
		const throughSeq = await this.pageCursorFor(sessionId);
		return this.pageAsHistory(
			await this.rpc(
				DSH_METHODS.page,
				DSH_ARGS.page({ address: this.addressFor(sessionId), throughSeq, beforeSeq })
			)
		);
	}

	/** Adapt a 0.1.2 SessionPage {records,hasMore} to the DshHistoryPage shape. */
	private pageAsHistory(raw: unknown): DshHistoryPage {
		const page = raw as {
			records?: unknown[];
			hasMore?: boolean;
			projections?: RawSessionProjections;
		};
		const records = Array.isArray(page?.records) ? page.records : [];
		const events = expandRecords(records as Array<{ type: string; event?: DshSessionEventLike }>);
		// 2026-09-16 chip-hidden bug fix: the TAIL page's projections block
		// (the permissions/imageLimits/goal baselines, DSH's own client seeds
		// from the same block) rode the wire but was dropped here — every
		// projection seeded from the cold load read undefined. Raw passthrough:
		// the ingesters (permission-state et al) own the validation.
		return {
			events: events.map((event) => ({ event })),
			hasMore: page?.hasMore === true,
			...(page?.projections !== undefined ? { projections: page.projections } : {})
		};
	}

	/**
	 * POC-2 W3 — session.create {cwd?, agentPreset?} → {sessionId, …}.
	 * Live-probed round-trip 2026-08-21 (probe7 → real session id).
	 */
	async createSession(
		cwd?: string,
		agentPreset?: string
	): Promise<{ sessionId: string; agentPreset?: string }> {
		return (await this.rpc(
			DSH_METHODS.create,
			DSH_ARGS.create({ ...(cwd === undefined ? {} : { cwd }), ...(agentPreset === undefined ? {} : { agentPreset }) })
		)) as {
			sessionId: string;
			agentPreset?: string;
		};
	}

	/**
	 * session/fork {request:{sessionId,atSeq?}} → {sessionId} — the fork child
	 * (The Fork Button ADR, 2026-09-01). An undefined atSeq is OMITTED from the
	 * args, never sent as null: the host then cuts at the source's last
	 * completed turn (host-enforced; see DSH_METHODS.fork for the pinned
	 * contract and refusals).
	 */
	async forkSession(sessionId: string, atSeq?: number): Promise<{ sessionId: string }> {
		return (await this.rpc(
			DSH_METHODS.fork,
			DSH_ARGS.fork({
				sessionId,
				...(atSeq === undefined ? {} : { atSeq })
			})
		)) as { sessionId: string };
	}

	/**
	 * POC-2 W3 — agentPreset.list → {presets:[…]} (live-probed 2026-08-21,
	 * rpc-map.ts line 54). Presets are the picker's only source of truth.
	 * The shipped-preset English overlay honors ~/.dsi/settings.yaml
	 * `dsh.presetEnglish` (default true; read live per call — no cache, so
	 * an operator edit applies on the next fetch without a restart).
	 */
	async listPresets(): Promise<{ presets: DshPreset[] }> {
		const overlayEnglish = readDshPresetEnglishConfig().presetEnglish;
		const raw = (await this.rpc(DSH_METHODS.presets, DSH_ARGS.presets())) as { presets?: unknown };
		const presets = Array.isArray(raw?.presets) ? raw.presets : [];
		return { presets: presets.map((row) => normalizePreset(row as RawPresetRow, overlayEnglish)) };
	}

	/**
	 * session.prompt — returns after the receipt only (BC-3 boundary lives
	 * upstream). Wave 2: a string payload still maps to exactly one text
	 * part (byte-identical for every pre-existing caller); a content array
	 * passes through verbatim — the route owns validation and ordering
	 * (buildPromptContent, images first, text last).
	 */
	async prompt(
		sessionId: string,
		payload: string | readonly DshPromptContent[],
		mode: 'queue' | 'steer' = 'queue'
	): Promise<{ accepted: boolean }> {
		const content = typeof payload === 'string' ? [{ type: 'text' as const, text: payload }] : payload;
		// 0.1.2: requestId is client-minted (SessionRequestId) and persisted on
		// the accepted user message; rpcId factory doubles as its source.
		return (await this.rpc(
			DSH_METHODS.prompt,
			DSH_ARGS.prompt({
				requestId: this.rpcIdFactory(),
				sessionId,
				mode,
				content,
				clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
			})
		)) as { accepted: boolean };
	}

	/**
	 * commands/execute (2026-08-25 fix) — the NATIVE slash-command surface the
	 * host's own web GUI uses (Typert Gateway remote; session.prompt has no
	 * slash interception — the 2026-08-25 RCA). Executes one line on the
	 * session's agent; the host durably logs command/run + command/done (and
	 * the permission command appends its knob events — the poll fold's
	 * confirmation). Returns null on an admission miss (the line named no
	 * registered command): ok:true, the command never ran — the honest
	 * receipt callers must distinguish from a success.
	 */
	async executeCommand(sessionId: string, line: string): Promise<DshCommandReceipt | null> {
		const value = (await this.rpc(
			DSH_METHODS.commandExecute,
			DSH_ARGS.commandExecute(sessionId, line, [])
		)) as DshCommandReceipt | undefined;
		return value ?? null;
	}

	/**
	 * commands/list (Slash Menu W1, task 1.2) — the host's command catalog,
	 * name-sorted rows {name, description, input?{hint, images?}}. Live-pinned
	 * 2026-08-30 (see tests/unit/dsh-rpc.test.ts): agentId IS the sessionId.
	 * May resume a cold session on the host — callers fetch on first menu
	 * open, never on panel mount (ADR §3.3).
	 */
	async listCommands(sessionId: string): Promise<DshCommandRow[]> {
		return (await this.rpc(DSH_METHODS.commandsList, DSH_ARGS.commandsList(sessionId))) as DshCommandRow[];
	}

	/**
	 * skills/list (Slash Menu W1, task 1.2) — the session's user-invocable
	 * skill catalog {skills:[{name, description, whenToUse?, modelInvocable}]}.
	 * Live-pinned 2026-08-30. Never activates a cold session — the menu may
	 * read it freely on first open.
	 */
	async listSkills(sessionId: string): Promise<DshSkillList> {
		return (await this.rpc(DSH_METHODS.skillsList, DSH_ARGS.skillsList(sessionId))) as DshSkillList;
	}

	/** session.cancel */
	async cancel(sessionId: string): Promise<{ accepted: boolean }> {
		return (await this.rpc(DSH_METHODS.cancel, DSH_ARGS.cancel({ sessionId }))) as { accepted: boolean };
	}

	/**
	 * POC-3 W3 (3.1) — session.rename {sessionId, title}.
	 *
	 * Appends a session/title event with the `user` source — pins the title
	 * against automatic regeneration (sessions.ts rename doc). The host
	 * normalizes; a title that normalizes to empty fails `title-invalid` (an
	 * RpcError → 502 upstream). Session-backed subagents reject `agent-busy`.
	 */
	async renameSession(sessionId: string, title: string): Promise<RenameResult> {
		return (await this.rpc(DSH_METHODS.rename, DSH_ARGS.rename({ sessionId, title }))) as RenameResult;
	}

	/**
	 * POC-3 W3 (3.2) — session.models {sessionId} → the model directory.
	 *
	 * Provider lookups run independently on the host (sessions.ts): `groups`
	 * are successfully-loaded catalogs, `failures` are provider-local
	 * diagnostics — successful groups remain usable. Garbage-safe normalize
	 * below never throws (task 3.2-T: garbage catalog → empty, not an error).
	 */
	async listModels(_sessionId: string): Promise<DsiModelDirectory> {
		void _sessionId;
		// 0.1.2: session.models → session/modelCatalog (host-generation,
		// no per-session argument).
		const raw = (await this.rpc(DSH_METHODS.modelCatalog, DSH_ARGS.modelCatalog())) as unknown;
		return normalizeModelDirectory(raw);
	}

	/**
	 * POC-3 W3 (3.2) — session.selectModel {sessionId, provider, model,
	 * reasoningEffort?} → {selected: ModelSelection}. Catalog membership is
	 * advisory on the host — an exact-route selection still validates the
	 * effort. Subagents reject `session/agent-busy` (RpcError → 502 upstream).
	 */
	async selectModel(
		sessionId: string,
		provider: string,
		model: string,
		reasoningEffort?: string
	): Promise<DsiModelSelection | null> {
		const raw = (await this.rpc(
			DSH_METHODS.selectModel,
			DSH_ARGS.selectModel({
				sessionId,
				provider,
				model,
				...(reasoningEffort !== undefined ? { reasoningEffort } : {})
			})
		)) as { selected?: unknown };
		// Garbage-safe even on the receipt: a malformed selection normalizes
		// to null — the route passes it through honestly, never invents data.
		return normalizeModelSelection(raw?.selected);
	}

	/**
	 * POC-3 W1 — answer a pending approval/question via the dedicated
	 * client-response carrier (POST /api/respond). NOT a unary method: no
	 * DSH_METHODS entry, no rpcId minted here — the rpcId is the REQUEST's
	 * stable id (registry key), echoed in the envelope. Receipt is a union,
	 * not ok/error: {accepted:false, reason} is a SUCCESSFUL exchange (BC-B
	 * upstream maps it to 200 + settle-elsewhere). Transport failure still
	 * throws (route maps to 503 — card stays answerable, lock released).
	 */
	/**
	 * POC-3 W1 → 0.1.2: an answer is a `$events/result` unary RPC
	 * {clientId, eventId, outcome} returning to the SAME generation whose
	 * $events stream delivered the waterfall (rpcId = the eventId DSI
	 * registered the card under). The outcome's `value` is the waterfall
	 * listener's RETURN VALUE, and the host consumes it verbatim — a
	 * question's value must BE the AskUserQuestionAnswer `{answers:[…]}`
	 * (the live host crashes the tool on any other shape, losing the
	 * answer); an approval's value is the outcome string. The panel's
	 * legacy `{sessionId, answer:{answers}}` wrapper is unwrapped here so
	 * the wire carries the host's contract, not the panel's convenience.
	 */
	async respond(rpcId: string, payload: Record<string, unknown>): Promise<RespondReceipt> {
		if (this.eventClientId === null) {
			throw new Error('dsh-connection: no $events generation to answer through yet');
		}
		// Legacy payloads carried {sessionId, outcome|answers}; the panel
		// sends questions as {sessionId, answer:{answers}}. All three arms
		// normalize to what the host's answerer waterfall must resolve with.
		const { sessionId, ...rest } = payload;
		void sessionId;
		const value =
			rest.outcome !== undefined
				? rest.outcome
				: rest.answer !== undefined
					? rest.answer
					: rest.answers !== undefined
						? { answers: rest.answers }
						: rest;
		try {
			await this.sendEventResult(rpcId, value);
			this.forgetAnswered(rpcId, value);
		} catch (err) {
			// 0.1.2-alpha.2+ wire truth: a LOST RACE is an idempotent no-op —
			// the gateway answers ok:true and swallows a result for an event
			// that already settled (or a delivery that is no longer ours), so
			// this arm cannot fire on current hosts. It stays for hosts that
			// still refuse through the answer door; the "answered elsewhere"
			// verdict now arrives as the settlement broadcast, not a receipt.
			if (err instanceof DshRpcError && err.code === 'not-pending') {
				return { accepted: false, reason: 'not-pending' };
			}
			// The gateway rejects answers naming a generation that already
			// ended (the mux rebuilt since the question was delivered — the
			// first click after such a rebuild always failed this way).
			// Self-heal: rebuild NOW and retry once; the host replays
			// still-pending waterfalls into the new generation, so the same
			// eventId stays answerable there. (0.1.2-alpha.2 renamed the
			// gateway's assembly failures from `internal` to `gateway/internal`
			// — the message text is unchanged.)
			if (
				err instanceof DshRpcError
				&& err.code === 'gateway/internal'
				&& err.message.includes('no active event stream')
			) {
				const previous = this.eventClientId;
				if (previous !== null && (await this.refreshEventGeneration(previous))) {
					await this.sendEventResult(rpcId, value);
					this.forgetAnswered(rpcId, value);
					return { accepted: true };
				}
			}
			throw err;
		}
		return { accepted: true };
	}

	/**
	 * Authenticated GET of one Host path (Edited-Files Card transport,
	 * 2026-09-25 — the changes.summary route's arm; Transport Probe note).
	 * Same cookie ladder as rpc(): mint-or-reuse, ONE 401 re-mint retry,
	 * then the response object as-is — the caller owns status mapping.
	 */
	async fetchHostPath(path: string, signal?: AbortSignal): Promise<Response> {
		const attempt = async (): Promise<Response> => {
			const cookie = await this.auth.ensureCookie();
			return this.fetchFn(`${this.baseUrl}${path}`, {
				method: 'GET',
				headers: cookie === null ? {} : { cookie },
				...(signal !== undefined ? { signal } : {})
			});
		};
		let response = await attempt();
		if (response.status === 401) {
			this.auth.invalidate();
			response = await attempt();
		}
		return response;
	}

	/** One $events/result answer under the CURRENT generation's clientId. */
	private sendEventResult(rpcId: string, value: unknown): Promise<void> {
		return this.rpc(
			REMOTE_EVENT_RESULT_ENDPOINT,
			{
				clientId: this.eventClientId,
				eventId: rpcId,
				outcome: { kind: 'result', value }
			} as unknown as Record<string, unknown>
		).then(() => undefined);
	}

	/**
	 * Rebuild the mux generation immediately (bypassing the reconnect
	 * ladder) and wait until a NEW $events ready frame lands or the deadline
	 * expires. Returns true only when a fresh clientId was observed — the
	 * caller may retry an answer against it.
	 */
	private async refreshEventGeneration(previousClientId: string): Promise<boolean> {
		this.log('dsh-connection: $events generation stale — rebuilding for the answer retry');
		if (this.reconnectTimer !== undefined) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		this.teardownSockets();
		this.ensureDownlinks();
		const deadline = Date.now() + this.staleGenerationRetryMs;
		while (!this.disposed && this.eventClientId === previousClientId && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return this.eventClientId !== previousClientId && this.eventClientId !== null;
	}

	/**
	 * Resync: replace the ring buffer with the ledger's tail page (BC-4).
	 * Returns the fresh entries so callers can hand them to the store.
	 */
	async resyncFromLedger(sessionId: string): Promise<DshSessionEvent[]> {
		const page = await this.history(sessionId);
		const events = (page.events ?? []).map((h) => h.event);
		const buf = this.bufferFor(sessionId);
		buf.entries = [...events].slice(-ringCapacity());
		buf.lastSeq = events.length > 0 ? events[events.length - 1].seq : -1;
		// After a ledger replace the buffer is contiguous from its first entry
		// again (the ledger page is the truth; no hole below the tail).
		buf.coverageFloor = buf.entries[0]?.seq ?? buf.lastSeq;
		return buf.entries;
	}

	// ── Transport plumbing ───────────────────────────────────────────────

	private async rpc(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		// 0.1.2: payload is the args envelope {args:{…}} (assertExactArguments).
		const body = JSON.stringify({ type: 'client-request', rpcId: this.rpcIdFactory(), method, payload: { args: payload } });
		const attempt = async (): Promise<Response> => {
			const cookie = await this.auth.ensureCookie();
			return this.fetchFn(rpcUrl(this.baseUrl, method), {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(cookie === null ? {} : { cookie })
				},
				body,
				...(signal !== undefined ? { signal } : {})
			});
		};
		let response = await attempt();
		if (response.status === 401) {
			// Fresh host process minted a new launch token requirement — one
			// re-mint with the CURRENT config token, one retry, then fail honest.
			this.auth.invalidate();
			const { authToken } = readDshAuthConfig();
			void authToken;
			response = await attempt();
		}
		if (!response.ok) {
			throw new Error(`dsh-connection: transport failure for ${method}: HTTP ${response.status}`);
		}
		const rpcId = (JSON.parse(body) as { rpcId: string }).rpcId;
		return parseResponse(await response.text(), rpcId);
	}

	dispose(): void {
		this.disposed = true;
		clearTimeout(this.answerReapTimer);
		this.teardownSockets();
		// Registry is transient control state — teardown never leaks entries.
		this.pendingAnswers.clear();
		this.settledAnswers.clear();
		this.buffers.clear();
		this.liveTails.clear();
		this.running.clear();
	}
}

/** Wire event form (SessionWireEvent as received over follow/page records). */
type DshSessionEventLike = {
type: string;
seq?: number;
time?: number;
data?: Record<string, unknown>;
};

/** The follow-<sessionId>-<streamSeq> logical stream id (one per generation). */
function followStreamId(sessionId: string, streamSeq: number): string {
	return `follow-${sessionId}-${String(streamSeq)}`;
}

/**
 * Expand ONE follow/page event payload into its ring-buffer form
 * (single-element list — ledger v2 serves every record as a plain event).
 */
function expandEntry(e: DshSessionEventLike): DshSessionEvent[] {
	return [
		{
			type: e.type,
			seq: typeof e.seq === 'number' ? e.seq : -1,
			time: typeof e.time === 'number' ? e.time : 0,
			data: e.data
		}
	];
}

/** Expand one page/snapshot record ({type:'event', event}) into its member
 *  events; a record without an event payload contributes nothing. */
function expandRecord(record: { type?: string; event?: DshSessionEventLike } | undefined): DshSessionEvent[] {
	if (record === undefined || record.event === undefined) return [];
	return expandEntry(record.event);
}

/** Expand a records array into a flat event list. */
function expandRecords(records: Array<{ type?: string; event?: DshSessionEventLike }>): DshSessionEvent[] {
	return records.flatMap((record) => expandRecord(record));
}

/** The last member time of one compact stream record, or undefined when
 *  the record carries no readable time (malformed members stay silent —
 *  the baseline is presentation seed data, never re-validated truth). */
function compactRecordTailTime(record: Record<string, unknown>): number | undefined {
	if (record.type === 'chunk') {
		return typeof record.time === 'number' ? record.time : undefined;
	}
	if (record.type === 'text-chunks' || record.type === 'reasoning-chunks' || record.type === 'tool-call-chunks') {
		const time0 = typeof record.time0 === 'number' ? record.time0 : undefined;
		const dt = Array.isArray(record.dt) ? record.dt : [];
		if (time0 === undefined || dt.some((g) => typeof g !== 'number')) return undefined;
		return dt.reduce((t, g) => t + (g as number), time0);
	}
	return undefined;
}

// ── Normalization helpers (session.list rows → DsiSessionSummary) ──────

/** session.rename receipt value: {title (normalized), seq (title event)}. */
export interface RenameResult {
	title: string;
	seq: number;
}

// ── POC-3 W3 (3.2) — model directory (SessionModels, garbage-safe) ─────────
// Client-facing shapes live in the shared layer ($lib/types — BC-2: the
// selector component must not import a server module); imported here for the
// forwards/normalize and re-exported for the routes' consumers.
import type { DsiModelSelection, DsiModelGroup, DsiModelDirectory, DsiWorkspaceSummary, DsiDirectoryListing, DsiDirectoryEntry, DsiLiveStreamTail } from '$lib/types';
export type { DsiModelSelection, DsiModelGroup, DsiModelDirectory };

function normalizeModelSelection(v: unknown): DsiModelSelection | null {
	if (v === null || typeof v !== 'object') return null;
	const sel = v as { provider?: unknown; model?: unknown; reasoningEffort?: unknown };
	if (typeof sel.provider !== 'string' || typeof sel.model !== 'string') return null;
	return {
		provider: sel.provider,
		model: sel.model,
		...(typeof sel.reasoningEffort === 'string' ? { reasoningEffort: sel.reasoningEffort } : {})
	};
}

/**
 * Conservative normalize of a SessionModels value: structural reads only,
 * never throws, never invents data (task 3.2-T: a garbage catalog → empty
 * groups + empty failures, honest `routable`/`current` — the selector can
 * still show the current selection and say nothing is listed). Reasoning
 * efforts are flattened to opaque ids (the adapter owns their meaning).
 */
export function normalizeModelDirectory(raw: unknown): DsiModelDirectory {
	const empty: DsiModelDirectory = { current: null, routable: false, groups: [], failures: [] };
	if (raw === null || typeof raw !== 'object') return empty;
	const dir = raw as {
		current?: unknown;
		default?: unknown;
		routable?: unknown;
		routableProviders?: unknown;
		groups?: unknown;
		failures?: unknown;
	};
	const groups = Array.isArray(dir.groups) ? modelGroupsOf(dir.groups) : [];
	const failures = Array.isArray(dir.failures) ? modelFailuresOf(dir.failures) : [];
	// 0.1.2 ModelCatalog: `default` replaces the per-session current and
	// routableProviders lists routable provider ids (empty + groups = routable).
	if (dir.current === undefined && dir.default !== undefined) {
		return {
			current: normalizeModelSelection(dir.default),
			routable: Array.isArray(dir.routableProviders)
				? dir.routableProviders.length > 0 || groups.length > 0
				: true,
			groups,
			failures
		};
	}
	return {
		current: normalizeModelSelection(dir.current),
		routable: dir.routable === true,
		groups,
		failures
	};
}

/** ModelCatalog provider groups → DsiModelGroup rows (conservative). */
function modelGroupsOf(groups: unknown[]): DsiModelGroup[] {
	return groups.flatMap((g) => {
		if (g === null || typeof g !== 'object') return [];
		const grp = g as { id?: unknown; name?: unknown; models?: unknown };
		if (typeof grp.id !== 'string' || grp.id.length === 0) return [];
		const models = Array.isArray(grp.models)
			? grp.models.flatMap((m) => {
				if (m === null || typeof m !== 'object') return [];
				const mod = m as {
					id?: unknown;
					name?: unknown;
					reasoning?: { efforts?: Array<{ id?: unknown }> } | null;
				};
				if (typeof mod.id !== 'string' || mod.id.length === 0) return [];
				return [
					{
						id: mod.id,
						name: typeof mod.name === 'string' ? mod.name : null,
						...(Array.isArray(mod.reasoning?.efforts)
							? {
									reasoningEfforts: mod.reasoning.efforts.flatMap((e) =>
										typeof e?.id === 'string' ? [e.id] : []
									)
								}
							: {})
					}
				];
			})
			: [];
		return [{ id: grp.id, name: typeof grp.name === 'string' ? grp.name : null, models }];
	});
}

/** ModelCatalog provider failures → diagnostic rows (conservative). */
function modelFailuresOf(failures: unknown[]): DsiModelDirectory['failures'] {
	return failures.flatMap((f) => {
		if (f === null || typeof f !== 'object') return [];
		const fail = f as { id?: unknown; name?: unknown; message?: unknown };
		if (typeof fail.id !== 'string' || fail.id.length === 0) return [];
		return [
			{
				id: fail.id,
				name: typeof fail.name === 'string' ? fail.name : null,
				message: typeof fail.message === 'string' ? fail.message : null
			}
		];
	});
}

/** session.history response value (sessions.schema.ts historyPage). */
export interface DshHistoryPage {
	events: DshHistoryEntry[];
	hasMore: boolean;
	/** TAIL-page-only projections block (sessions.ts history: only the tail
	 * page carries it). Present when the deployment mounts the projection
	 * registry — the title for the header lives here (POC-3 W3 rename seed). */
	projections?: RawSessionProjections;
}

/** SessionProjectionsBlock (sessions.ts) — values keyed by projection key. */
export interface RawSessionProjections {
	asOfSeq?: number;
	values?: Record<string, unknown>;
}

/** workspace.create response view (api/workspace.schema.ts shape). */
export interface DshWorkspaceView {
	workspaceId: string;
	path: string;
	title: string;
	sessionIds: string[];
	createdAt: string;
	updatedAt: string;
}

export interface DshWorkspaceCreateResult {
	workspace: DshWorkspaceView;
	created: boolean;
}

export interface RawSessionRow {
	sessionId: string;
	updatedAt?: number;
	running?: boolean;
	blank?: boolean;
	cwd?: string;
	agentPreset?: string;
	parentSessionId?: string;
	/** Coarse durable origin (DSH session.list passthrough) — 'subagent'
	 *  marks spawned sessions; absent on user-created ones. */
	origin?: 'subagent';
	/** Host stats block on the session.list projection (2026-08-25 a2a
	 *  watermark — Watcher ADR §2); absent on hosts/rows without stats. */
	sessionStats?: { turns?: unknown };
	projections?: {
		asOfSeq?: number;
		values?: Record<string, unknown>;
	};
}

export type ListResult = { items: ReturnType<typeof normalizeSessionRow>[] };

export function normalizeSessionRow(row: RawSessionRow): DsiSessionSummaryPlus {
	return {
		sessionId: row.sessionId,
		// Subagent rows lead with the delegation's descriptor label ("Find
		// DSH /api/respond handler"), not the generic prompt-derived session
		// title — the label is how a spawned session is findable in a long list.
		title:
			row.origin === 'subagent'
				? (readSubagentLabel(row) ?? readTitle(row))
				: readTitle(row),
		// 0.1.2: agentPreset lives in projections.values (list rows carry no
		// top-level field) — readTitle's pattern, extended.
		agentPreset: readAgentPreset(row) ?? row.agentPreset ?? null,
		running: Boolean(row.running),
		blank: Boolean(row.blank),
		updatedAt: row.updatedAt ?? 0,
		workspace: typeof row.cwd === 'string' && row.cwd.length > 0 ? row.cwd : null,
		turns: readTurns(row),
		// Lineage passthrough (2026-08-27 lineage sidebar, task 1.3): the
		// host stamps every spawned session; absent → null (never undefined,
		// never a guess). Fork lineage (parentSessionId without origin
		// 'subagent') passes through untouched — consumers discriminate.
		parentSessionId: row.parentSessionId ?? null,
		origin: row.origin ?? null
	};
}

export interface DsiSessionSummaryPlus {
	sessionId: string;
	title: string | null;
	agentPreset: string | null;
	running: boolean;
	blank: boolean;
	updatedAt: number;
	/** Session workspace — the host row's cwd (full path); null when absent. */
	workspace: string | null;
	/** a2a watermark (2026-08-25): completed-turn count, absent-tolerant. */
	turns: number | null;
	/** Spawner session id (fork/spawn lineage passthrough); null for roots. */
	parentSessionId: string | null;
	/** 'subagent' when the harness spawned this session; null for user-made. */
	origin: 'subagent' | null;
}

function readTitle(row: RawSessionRow): string | null {
	const title = row.projections?.values?.['title'];
	return typeof title === 'string' && title.length > 0 ? title : null;
}

/** projections.values.subagent.label (the child descriptor's creation label;
 *  one-shot children may omit it — structural read, null when unreadable). */
function readSubagentLabel(row: RawSessionRow): string | null {
	const identity = row.projections?.values?.['subagent'];
	const label =
		identity !== null && typeof identity === 'object'
			? (identity as { label?: unknown }).label
			: undefined;
	return typeof label === 'string' && label.length > 0 ? label : null;
}

/** projections.values.agentPreset (0.1.2 home of the preset id on list rows). */
function readAgentPreset(row: RawSessionRow): string | null {
	const preset = row.projections?.values?.['agentPreset'];
	return typeof preset === 'string' && preset.length > 0 ? preset : null;
}

/** `sessionStats.turns` (0.1.2: projections.values.sessionStats) — integer-strict, null on absent/junk. */
function readTurns(row: RawSessionRow): number | null {
	const stats = row.projections?.values?.['sessionStats'];
	const turns = (stats !== null && typeof stats === 'object' ? (stats as { turns?: unknown }).turns : row.sessionStats?.turns);
	if (typeof turns !== 'number' || !Number.isInteger(turns) || turns < 0) return null;
	return turns;
}

// ── POC-2 W3 — agentPreset.list normalization ─────────────────────────

/** A picker-facing preset row (agentPreset.list value → DsiPreset). */
export interface DshPreset {
	id: string;
	name: string | null;
	description: string | null;
	isDefault: boolean;
}

/** agentPreset.list raw row (live-probed 2026-08-21, PRD §1.2). */
interface RawPresetRow {
	id?: unknown;
	name?: unknown;
	description?: unknown;
	trust?: unknown;
	isDefault?: unknown;
}

/**
 * English display copy for the host's SHIPPED presets, keyed by the stable
 * preset id. The wire's `name`/`description` are the UNLOCALIZED metadata a
 * preset publishes (DSH `PresetDisplaySource`), and the four built-ins ship
 * Simplified Chinese there — DSH localizes them only inside its own web UI
 * (`packages/preset/agent-presets/src/display.ts` folds trust:'system' + id →
 * locale dictionary keys). This app has no host locale seat, so the overlay
 * mirrors that fold in English: trust:'system' + a known id → the English
 * copy; every other row (user presets, unknown future ids) keeps the host's
 * name verbatim — user metadata is never translated, and an unknown id falls
 * back honestly. Operator-tunable off via ~/.dsi/settings.yaml
 * `dsh.presetEnglish: false` (readDshPresetEnglishConfig — no cache, so the
 * next listPresets fetch picks an edit up). Keep the strings in step with DSH
 * `packages/client/ui-agent-preset/src/client/locales.ts` (the `en` bundle).
 */
const SHIPPED_PRESET_ENGLISH: Readonly<Record<string, { readonly name: string; readonly description: string }>> = {
	standard: {
		name: 'Standard mode',
		description:
			'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.'
	},
	ptc: {
		name: 'PTC mode',
		description:
			'Full coding agent without the workflow tool; other tools are exposed through the PTC mode SDK so the model can combine multi-step operations in one TypeScript program.'
	},
	minimal: {
		name: 'Minimal mode',
		description: 'Two-tool coding agent with persistent bash and str_replace_editor.'
	},
	cordis: {
		name: 'Creator mode',
		description:
			'Built for creating custom agent presets, with all Standard mode capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.'
	}
};

/**
 * Conservative normalize: unknown shapes keep their id but never invent data.
 * The one English overlay seat (SHIPPED_PRESET_ENGLISH) applies before the
 * host fallbacks — a shipped preset's label is locale-resolved here, never
 * the wire's unlocalized text. Operator-tunable via
 * ~/.dsi/settings.yaml `dsh.presetEnglish` (read live per listPresets
 * call, passed through here): false hands the wire name through untouched.
 */
export function normalizePreset(row: RawPresetRow, overlayEnglish = true): DshPreset {
	const id = typeof row.id === 'string' ? row.id : String(row.id ?? '');
	const shipped = overlayEnglish && row.trust === 'system' ? SHIPPED_PRESET_ENGLISH[id] : undefined;
	return {
		id,
		name: shipped?.name ?? (typeof row.name === 'string' ? row.name : null),
		description: shipped?.description ?? (typeof row.description === 'string' ? row.description : null),
		isDefault: row.isDefault === true
	};
}
