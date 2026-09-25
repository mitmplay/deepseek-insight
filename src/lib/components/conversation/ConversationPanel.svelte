<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * ConversationPanel — one session's full conversation body (extracted
	 * from the conversation page, Panel Floor W2 task 2.1, ADR-0006):
	 * header wiring, chip-popup state, load-older paging, error banner,
	 * answerer cards, context-token derivation, scroll area + floating
	 * anchor, and the footer. Self-contained: the panel CREATES and OWNS
	 * its store + orchestrator (the page no longer holds them), so N
	 * panels can later coexist on the workspace floor (W3) with per-panel
	 * state by construction.
	 *
	 * Zero behavior change at extraction (W2 contract): every moved line
	 * keeps its semantics and every data-testid stays verbatim; the full
	 * e2e suite must pass unmodified.
	 *
	 * BC-2: components + services only — no $lib/server imports. BC-1:
	 * every byte flows through /api/dsh/* (load-older + answer carrier).
	 *
	 * Slash Menu (2026-08-30): the panel bridges the session's host
	 * catalog to the composer (slashCatalog/onslashopen) and routes both
	 * command surfaces — menu picks AND the submit-ladder rung after
	 * parseCommand declines — through executeHostCommand; notes ride the
	 * existing command banner. Catalog reads fire on first menu open,
	 * never at mount (cold sessions stay cold).
	 */
	import { onMount } from 'svelte';
	import { createConversationStore } from '$lib/services/conversation/store.svelte';
	import { createPollingOrchestrator } from '$lib/services/conversation/polling-orchestrator.svelte';
	import { invalidateSessionAttachmentUrls } from '$lib/services/conversation/attachment-urls.svelte';
	import ConversationError from '$lib/components/conversation/ConversationError.svelte';
	import StickToBottomToggle from '$lib/components/chat/StickToBottomToggle.svelte';
	import ConversationFooter from '$lib/components/conversation/ConversationFooter.svelte';
	import ConversationHeader from '$lib/components/conversation/ConversationHeader.svelte';
	import ConversationScrollArea from '$lib/components/conversation/ConversationScrollArea.svelte';
	import ConversationFloatingAnchor from '$lib/components/conversation/ConversationFloatingAnchor.svelte';
	import A2aChipStack from '$lib/components/conversation/A2aChipStack.svelte';
	import ConversationStatsBar from '$lib/components/conversation/ConversationStatsBar.svelte';
	import { deriveSessionStats, statsFromLedger } from '$lib/services/conversation/session-stats';
import { appConfig } from '$lib/services/config/app-config.svelte';
	import { setPanelMode } from '$lib/services/conversation/panel-context.svelte';
	import { setConversationSession } from '$lib/services/conversation/session-context.svelte';
	import { getCurrentModel } from '$lib/services/conversation/current-model';
	import { parseCommand } from '$lib/services/chat/command-parser';
	import {
		executeCommand,
		executeHostCommand,
		resolveHostCommand,
		sendPrompt
	} from '$lib/services/chat/command-executor';
	import { directoryFor, type SlashDirectory } from '$lib/services/chat/slash-directory.svelte';
	import { macroRunner, macroRunState, TYPED_DRAFT_ID } from '$lib/services/chat/macro-runner.svelte';
	import { isTypedRun } from '$lib/services/chat/macro-sections';
	import MacroRunSheet from '$lib/components/conversation/MacroRunSheet.svelte';
	import GoalBar from '$lib/components/conversation/GoalBar.svelte';
	import type { DsiPermission } from '$lib/services/conversation/permission-state';
	import type { DshRawEvent } from '$lib/services/conversation/dsh-events';
	import { contextWindowOf } from '$lib/utils/context-window';
	import { isTodoTool } from '$lib/utils/todo-lists';
	import { groupTurns } from '$lib/utils/turn-grouping';
	import { parseGoalView } from '$lib/utils/goals';
	import type { DsiEntry, PendingAnswer, AnsweredSettlement, DsiA2aExchangeView } from '$lib/types';

	let {
		panelId = null,
		sessionId,
		title: initialTitleProp = null,
		workspace = null,
		workspaces = [],
		agent,
		agentDisplay = null,
		subagent = false,
		depth = 0,
		parentSessionId = null,
		entries,
		lastSeq,
		running,
		hasMore = undefined,
		pendingAnswers = [],
		settledAnswers = [],
		permission = null,
		imageLimits = undefined,
		knobEvents = undefined,
		a2aRows = [],
		a2aTitles = {},
		onNeedCold = undefined,
		onClose = undefined,
		focusComposer = false,
		oncomposerfocus = undefined,
		focused = false,
		onOpenExplorer = undefined,
		/** File Link Intent (ADR 2026-09-25 D1/D2): transcript file links become
		 *  explorer intents — the route supplies the gated handler. */
		onFileLink = undefined
	}: {
		/** Owning floor panel's id (the /new successor swap targets it; null
		 * outside a floor — /new then reports it cannot run here). */
		panelId?: string | null;
		/** The DSH session this panel renders (panel identity, W3 key). */
		sessionId: string;
		/** Cold-load title (tail-page projections); null = header falls back to the id. */
		title?: string | null;
		/** The session's workspace (cwd from session.list) — header chip; null = none. */
		workspace?: string | null;
		/** Host workspace registry (spine feed) — the header chip's
		 *  title-first label + ghost authority (ADR D5, 2026-09-07). */
		workspaces?: import('$lib/types').DsiWorkspaceSummary[];
		/** Agent preset id (wire identity — /new creates with it; null = none). */
		agent: string | null;
		/** Header chip display override — the host catalog's name for the
		 *  preset (DSH picker parity: `cordis` reads `Creator mode`); absent
		 *  or null falls back to the raw id. Never crosses the wire. */
		agentDisplay?: string | null;
		/** True for sub-agent sessions (lineage subagentIds): the host's
		 *  generic routing fences them — session.rename and session.prompt
		 *  reject `agent-busy` ("owned by subagent routing") — so the panel
		 *  renders READ-ONLY: plain title, no composer, beige transcript. */
		subagent?: boolean;
		/** Lineage depth (depthById; 0 = root session). Modulates the
		 *  sub-agent transcript tint only — every depth ≥ 1 is equally
		 *  read-only. */
		depth?: number;
		/** The fork source's session id (the spine row's parentSessionId) —
		 *  the header's parent button jump target; null = no button. */
		parentSessionId?: string | null;
		/** Cold-load entries (ledger tail). ABSENT on a runtime-added panel
		 * before its cold fetch (W3 3.1 dual fetch) — the empty store then
		 * fills when the owner remounts the panel with real cold props; an
		 * absent array also fires onNeedCold once at mount. */
		entries?: DsiEntry[];
		/** Cold-load ledger tail seq (buffer truth when present). */
		lastSeq: number;
		/** A turn was already running at cold load. */
		running: boolean;
		/** Ledger says older pages exist (load-older sentinel). */
		hasMore?: boolean;
		/** Pending/settled answers at cold load (a blocked turn was already
		 * waiting when the panel opened). */
		pendingAnswers?: PendingAnswer[];
		settledAnswers?: AnsweredSettlement[];
		/** Access-mode projections baseline at cold load (ADR-0007); null =
		 *  the host ships none and knob events alone decide. */
		permission?: DsiPermission | null;
		/** Host admission numbers from the cold load's imageLimits projection
		 *  (W4 task 4.2) — threaded to the composer's pre-flight; absent →
		 *  the service's DSH documented defaults (BC-A6). */
		imageLimits?: import('$lib/services/conversation/image-limits').DsiImageLimits;
		/** Raw knob events from the cold window (ADR-0007) — the store's
		 *  delta-application base (folded once at seed). */
		knobEvents?: DshRawEvent[];
		/** This panel's delegation-ledger rows (W4 4.2) — the sender-side a2a
		 *  chip join, fed by the page's EXISTING spine-cadence poll of
		 * GET /api/a2a?from=<sessionId>. Read-only; the panel owns no fetch,
		 * no timer (BC-7: zero new client timers). Empty = no chips. */
		a2aRows?: DsiA2aExchangeView[];
		/** Live target titles keyed by sessionId (the spine rows the page
		 *  already holds) — the chips show target titles, not uuids. */
		a2aTitles?: Record<string, string | null>;
		/** Runtime-added panel hook (W3 3.1): fired ONCE at mount when the
		 * panel has no cold data yet — the floor owner then dual-fetches
		 * (events?full=1 + history) and remounts with real props. Never
		 * fires on the SSR seed path (entries always provided). */
		onNeedCold?: (sessionId: string) => void;
		/** Close affordance for the panel header (W3 PanelHeader); unused
		 * while the page embeds a single panel. */
		onClose?: () => void;
		/** The floor marked THIS panel's next mount for the composer focus
		 *  (the /new swap-focus, 2026-08-29): the fresh panel's textarea
		 *  takes the caret once. The route passes it one-shot — a plain
		 *  page load or restored desk never sets it. */
		focusComposer?: boolean;
		/** Fired once after the mount focus landed — the route clears its
		 *  one-shot marker on it. */
		oncomposerfocus?: () => void;
		/** This panel is the floor's focused panel (the route's
		 *  selectedPanelId) — the composer footer tints oldlace. */
		focused?: boolean;
		/** Workspace-chip click intent (Workspace Explorer W3 task 3.2,
		 *  ADR D4) — pass-through to the header's identity cluster. */
		onOpenExplorer?: (sessionId: string, workspace: string) => void;
		onFileLink?: (href: string) => void;
	} = $props();

	// Embedded mode (OCI panel-context port, 2026-08-24 — the per-panel
	// FloatingAnchor fix): a ConversationPanel is ALWAYS a panel on the
	// conversation floor, so descendants (FloatingAnchor) anchor
	// absolutely to this component's `relative` root instead of piling
	// onto the viewport's right-middle when N panels coexist.
	setPanelMode(true);
	// Transcript descendants (FilesEditedCard) derive their fetch target
	// from this — the panel is the sessionId authority (2026-09-25).
	setConversationSession(sessionId);

	// Intentional initial capture: the store is bound to THIS session for
	// its lifetime; the conversation layout keys the page by sessionId
	// (and W3's PanelColumn keys the panel by sessionId), so a session
	// change remounts rather than re-initializes.
	// svelte-ignore state_referenced_locally
	const store = createConversationStore(sessionId);
	const orchestrator = createPollingOrchestrator(store);

	// Cold-load seed at init — SSR + first paint render the ledger transcript
	// (same intentional initial capture as above). An absent entries array
	// (runtime-added panel, pre-cold) seeds an empty store instead.
	// svelte-ignore state_referenced_locally
	if (entries !== undefined) store.replaceAll(entries);
	// svelte-ignore state_referenced_locally
	store.applyStatus(running, lastSeq);
	// POC-3 W2 (2.3): cold load may already carry pending answers — seed the
	// cards before the first poll. Intentional initial capture: the ledger's
	// pending snapshot at open.
	// svelte-ignore state_referenced_locally
	store.applyAnswers(pendingAnswers, settledAnswers);
	// ADR-0007 (2026-08-25): the access mode rides the cold load — the
	// projections baseline + the window's raw knob events seed the store
	// once (poll deltas accumulate from here). Intentional initial
	// capture: the cold window's permission facts are load-time constants.
	// svelte-ignore state_referenced_locally
	store.seedPermission(permission, knobEvents);

	let submitted = $state(false);

	/** Chip popup state (2026-08-22, OCI pattern): ONE open chip at a time —
	 * the id of the expanded entry; detail renders AFTER the chip row.
	 * Per-panel by construction (moved here with the block). */
	let openChipId: string | null = $state(null);
	function toggleChip(id: string, autoOpen = false): void {
		// Collapsing an AUTO-OPENED chip suppresses that slot until a newer
		// target appears (the suppression is id-tied — stale ids never match).
		if (autoOpen) {
			if (id === autoPlanId) planSuppressedId = id;
			else if (autoThinkId !== null && id === `r:${autoThinkId}`) thinkSuppressedId = autoThinkId;
			return;
		}
		openChipId = openChipId === id ? null : id;
		peekOpenRunKey = null; // peek and chip expansion are mutually exclusive
	}

	// ── Auto-open the live Think AND the current plan (2026-08-31) ──────
	// While the panel STREAMS and the reader FOLLOWS the live end (stick),
	// TWO auto-open slots run INDEPENDENTLY (neither flows through the
	// single manual openChipId, so they never close each other):
	//
	//   think — the LATEST think chip (the one still thinking). Transient:
	//   a newer think MOVES the open, and the turn ending (or leaving the
	//   live end) closes it.
	//
	//   plan — the LATEST todo_write chip (the agent's current plan).
	//   PERSISTENT: it survives newer thinks AND the turn ending — the plan
	//   stays readable after the work is done. Only a NEWER todo_write
	//   supersedes it (the open moves), or the user collapses it.
	//
	// Both recomputed on every poll; collapsing an auto chip suppresses
	// THAT slot until its next target appears. Neither slot touches manual
	// picks — an openChipId popup renders beside them.
	let thinkSuppressedId: string | null = $state(null);
	let planSuppressedId: string | null = $state(null);

	/** The newest reasoning entry's id (wire order) while streaming AND
	 *  stuck to the live end, else null — the transient think target. */
	const autoThinkTargetId = $derived.by(() => {
		if (!store.isStreaming || !stick) return null;
		const renderEntries = store.renderEntries;
		for (let i = renderEntries.length - 1; i >= 0; i--) {
			const e = renderEntries[i]!;
			if (e.kind === 'assistant-message' && e.reasoning !== undefined && e.reasoning !== '') return e.id;
		}
		return null;
	});
	/** Suppression-aware think target: null while the user kept THIS think
	 *  collapsed (a newer think id simply stops matching). */
	const autoThinkId = $derived(
		autoThinkTargetId !== null && thinkSuppressedId === autoThinkTargetId ? null : autoThinkTargetId
	);

	/** The newest todo_write entry's id, STICKY: adopted only while
	 *  streaming AND stuck (the detection window), then kept across newer
	 *  thinks, turn end, and scroll-away — the plan stays on screen until
	 *  a newer todo_write supersedes it or the user collapses it. */
	let autoPlanIdRaw: string | null = $state(null);
	$effect(() => {
		if (!store.isStreaming || !stick) return;
		const renderEntries = store.renderEntries;
		for (let i = renderEntries.length - 1; i >= 0; i--) {
			const e = renderEntries[i]!;
			if (e.kind === 'tool-call' && isTodoTool(e.toolName)) {
				autoPlanIdRaw = e.id;
				break;
			}
		}
	});
	/** Suppression-aware plan target (same id-tied rule as the think). */
	const autoPlanId = $derived(
		planSuppressedId !== null && planSuppressedId === autoPlanIdRaw ? null : autoPlanIdRaw
	);

	/** Peek popup state (ToolPeekButton port, 2026-08-22): the run key whose
	 * chip row has its list popup open — ONE at a time, and never while a
	 * chip detail popup is open (OCI mutual-exclusion contract). */
	let peekOpenRunKey: string | null = $state(null);
	function togglePeek(runKey: string): void {
		peekOpenRunKey = peekOpenRunKey === runKey ? null : runKey;
		if (peekOpenRunKey !== null) openChipId = null;
	}

	/** OCI two-group render (2026-08-21): prompt / context / assistant-turn. */
	const groups = $derived(groupTurns(store.renderEntries));

	// ── POC-2 W3: load-older paging (ledger truth, BC-4) ────────────────────
	// hasMore drives the sentinel: hidden once the ledger head is reached.
	// Intentional initial capture: hasMore is a property of the COLD LOAD's ledger
	// page; later pages refresh it inside loadOlder. svelte-ignore state_referenced_locally
	// svelte-ignore state_referenced_locally
	let hasOlder = $state(hasMore);
	let loadingOlder = $state(false);
	let olderError = $state<string | null>(null);
	/** First seq currently on screen — the page anchor for the next fetch. */
	let firstSeq = $state(entriesFirstSeq());

	function entriesFirstSeq(): number {
		return store.entries.length > 0 ? store.entries[0].seq : -1;
	}

	/** Chat transcript viewport element (bound in markup). */
	let viewport = $state<HTMLElement | undefined>(undefined);
	/** Stick-to-bottom mirror (2026-08-26): bound to the scroll area's
	 *  scroll-stick flag, read by the composer toggle. A manual re-engage
	 *  also scrolls to the live end — the toggle's ON promise. */
	let stick = $state(true);

	/** Composer stick flip: OFF just releases; ON re-engages AND jumps
	 *  to the live end (OCI forceStick parity — promising follow without
	 *  going there would be a lying button). The far-edge up jump rides
	 *  the OFF arm first — BackToTheEdgeButton's onleavebottom reports
	 *  before its viewport move (2026-09-08). */
	function onStickToggle(next: boolean): void {
		stick = next;
		if (next && viewport) {
			viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
		}
	}

	// Prepend scroll anchoring moved INTO ConversationScrollArea
	// (2026-08-24, auto load-older): it must coordinate with the stick
	// effect that lives there — the old capture/restore here replayed a
	// RAW scrollTop after the DOM grew, pointing into the freshly
	// prepended page and fighting both native anchoring and stick.

	// In-flight join (2026-08-26 shift-drain): loadOlder is reachable
	// from THREE triggers — the sentinel's observer, the manual button,
	// and the drain loop. The old boolean guard made concurrent callers
	// silently no-op: a drain that started while the sentinel's page was
	// mid-flight would see hasOlder still true, await nothing, and end
	// "done" with pages left. Joining the shared promise instead makes
	// every caller observe the SAME completion.
	let olderInFlight: Promise<void> | null = null;

	async function loadOlder(): Promise<void> {
		if (olderInFlight) return olderInFlight;
		const run = (async () => {
			if (!hasOlder || firstSeq <= 0) return;
			loadingOlder = true;
			olderError = null;
			try {
				const url = `/api/dsh/session/${encodeURIComponent(sessionId)}/history?beforeSeq=${firstSeq}`;
				const res = await fetch(url);
				const body = (await res.json()) as {
					ok: boolean;
					entries?: DsiEntry[];
					hasMore?: boolean;
					error?: { code: string; message: string };
				};
				if (!res.ok || !body.ok) {
					// Failure keeps the list intact — the user can scroll again to retry.
					olderError = body.error?.message ?? `load older failed (${res.status})`;
					return;
				}
				const added = store.prependOlder(body.entries ?? []);
				hasOlder = body.hasMore === true && added;
				firstSeq = entriesFirstSeq();
			} catch (err) {
					olderError = err instanceof Error ? err.message : String(err);
			} finally {
				loadingOlder = false;
			}
		})();
		olderInFlight = run;
		try {
			await run;
		} finally {
			olderInFlight = null;
		}
	}

	/** Shift+click far-edge jump (2026-08-26): drain EVERY remaining older
	 *  page before the jump lands. Without it a plain "Back to top" reaches
	 *  only the top of the loaded window — the sentinel auto-loads one page,
	 *  the prepend anchor keeps the viewport put, and a long conversation
	 *  costs one click per page. The drain ends on ledger truth (hasMore
	 *  false, a duplicate page, or the head); the progress check is the
	 *  belt-and-braces that can never loop on a standing answer, and the
	 *  cap surfaces a lying server as an honest error, never a spinner. */
	const LOAD_ALL_MAX_PAGES = 200;

	async function loadAllOlder(): Promise<void> {
		for (let i = 0; i < LOAD_ALL_MAX_PAGES; i += 1) {
			if (!hasOlder || olderError !== null || firstSeq <= 0) return;
			const before = firstSeq;
			await loadOlder();
			if (!hasOlder || olderError !== null) return;
			if (firstSeq === before) return;
		}
		olderError = `stopped after ${LOAD_ALL_MAX_PAGES} pages — the ledger kept reporting more`;
	}

	onMount(() => {
		// Runtime-added panel without cold data (W3 3.1): ask the floor owner
		// for the dual-fetch cold load. The SSR seed path always has entries,
		// so this never fires there.
		if (entries === undefined && onNeedCold) onNeedCold(sessionId);
		void orchestrator.start();
		// OCI percentage parity (2026-08-24): learn the session's model once
		// (cached per session) — the context window resolves from it.
		void getCurrentModel(sessionId).then((m) => {
			currentModel = m;
		});
		return () => {
			orchestrator.stop();
			// BC-A9 (task 3.4): the panel that showed this session's images
			// owns their object URLs — closing it revokes them and bumps the
			// cache generation so in-flight reads never publish.
			invalidateSessionAttachmentUrls(sessionId);
		};
	});

	/** Wave 2: images arrive serialized from the composer (PromptInput owns
	 *  the only base64 moment — serialize-at-submit, BC-A2) and ride the
	 *  widened submit; the boolean admits/denies draft clearing (BC-A3). */
	/** Wave 2: images arrive serialized from the composer (PromptInput owns
	 *  the only base64 moment — serialize-at-submit, BC-A2) and ride the
	 *  widened submit; the boolean admits/denies draft clearing (BC-A3).
	 * Commands delegate to the shared executor (Prompt Macro W1 1.2 — one
	 * command/send surface for the typed path AND the macro runner); ordinary
	 * sends flow through sendPrompt so the /use record guard lives in ONE
	 * place (Suggest Strip ADR D5 contract, byte-identical). */
	async function onsubmit(text: string, images: readonly { mediaType: string; data: string; name?: string }[]): Promise<boolean> {
		// The Typed Run (2026-09-16, D3): a uniformly directive multi-line
		// draft (every non-blank line starts /, @, or ? and there are at
		// least two) enters the EXISTING runner as a synthetic row — the
		// predicate routes BEFORE parseCommand, whose single whole-draft
		// parse would otherwise bury line 2 in line 1's args. The runner
		// applies slashBoundaries on the synthetic row's behalf (the single
		// call-site divergence, macro-runner start); a refusal (live run,
		// D4) banners through startMacro's existing note path. Single-line
		// and mixed drafts fail the predicate and fall through byte-identical.
		if (isTypedRun(text)) {
			startMacro({ text, id: TYPED_DRAFT_ID }, false);
			return true; // dispatch completed — drafts clear (BC-A7)
		}
		// Slash-command intercept (2026-08-25, OCI parser port): known
		// commands run panel-side and never reach the model; unknown lines
		// fall through as ordinary chat (the parser returns null).
		const command = parseCommand(text);
		if (command !== null) {
			// onNote fires at the typed path's ORIGINAL banner points (the
			// mention path notes at the prompt receipt, before the register);
			// the final result covers everything else.
			let bannered = false;
			const result = await executeCommand(command, executorCtx(), (ok, note) => {
				bannered = true;
				noteCommand(ok ? 'ok' : 'error', note);
			});
			// The final note re-fires ONLY when no in-flight note landed
			// (mention/permission bannered at their original points — a
			// duplicate final fire would re-set the banner kind).
			if (!bannered && result.note !== undefined) {
				noteCommand(result.ok ? 'ok' : 'error', result.note);
			}
			return true; // completed dispatch clears drafts (BC-A7)
		}
		if (text.trim().length === 0 && images.length === 0) return false; // nothing to send
		// Slash Menu ladder rung (Slash Menu ADR §3.2, task 2.3): the parser
		// DECLINED — a first token naming a row of the CACHED command
		// catalog executes through the native command route with the FULL
		// line (arguments never re-parsed). Precedence is structural: the
		// typed-gesture block above ran first; a name shared by a command
		// and a skill resolves to the COMMAND because the ladder consults
		// only the command rows (the native adjudication). result.ok
		// admits/clears: a miss or error keeps the draft (BC-A3) — the
		// honest banner note is the receipt, never a fallback model send.
		if (slashCatalog?.state === 'ready') {
			const hostCommand = resolveHostCommand(text, slashCatalog.commands);
			if (hostCommand !== null) {
				const result = await executeHostCommand(text, executorCtx(), (ok, note) =>
					noteCommand(ok ? 'ok' : 'error', note)
				);
				return result.ok;
			}
		}
		submitted = true;
		try {
			const result = await sendPrompt(text, executorCtx(), (t) =>
				// Text-only on the macro path; manual sends with images keep the
				// panel's own orchestration (optimistic bubble + poll cadence).
				orchestrator.submit(t, images)
			);
			return result.ok;
		} finally {
			submitted = false;
		}
	}

	async function oncancel(): Promise<void> {
		await orchestrator.cancel();
	}

	// ── Slash commands (2026-08-25) — OCI ChatInput banner pattern ──────
	/** Inline command feedback (role=status, auto-dismiss 5s) — the ONLY
	 * command UI surface; the input has already cleared by intercept time.
	 * The wire work lives in command-executor (Prompt Macro W1 1.2): the
	 * /new create+swap, /permission route, and mention delivery are the
	 * SAME bytes the typed path always sent — the panel now renders
	 * outcomes only (banner kind from result.ok). */
	let commandNote = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	let commandNoteTimer: ReturnType<typeof setTimeout> | undefined;

	function noteCommand(kind: 'ok' | 'error', text: string): void {
		commandNote = { kind, text };
		if (commandNoteTimer !== undefined) clearTimeout(commandNoteTimer);
		commandNoteTimer = setTimeout(() => (commandNote = null), 5_000);
	}

	// ── Goal bar wiring (ADR "The Goal Bar", 2026-09-08, D3 as amended
	// 2026-09-08: actions ride the host's goals/* Remotes — commands/execute
	// does not admit /goal on the web plane) ─────────────────────────────
	/** True while a goals/* verb is in flight — the chip drops re-clicks
	 *  (the CAS ref comes from the CURRENT rendered goal; a stale one loses
	 *  host-side and the next projection delta corrects the bar). */
	let goalBusy = $state(false);

	/** Send one goals/<verb> mutation with the goal's CAS ref. The edit
	 *  verb carries the changed-fields payload (Goal Editor ADR D3). */
	async function runGoalVerb(
		verb: 'pause' | 'resume' | 'clear' | 'edit',
		payload?: { objective?: string; maxGoalRounds?: number }
	): Promise<void> {
		const goal = store.goal;
		if (goalBusy || goal === null || goal === undefined) return;
		goalBusy = true;
		try {
			const res = await fetch(`/api/dsh/session/${encodeURIComponent(sessionId)}/goal`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					verb,
					ref: { id: goal.id, revision: goal.revision },
					...(payload === undefined ? {} : { edit: payload })
				})
			});
			const body = (await res.json().catch(() => null)) as
				| { ok?: boolean; error?: { message?: string } }
				| null;
			if (body?.ok === true) {
				// The RemoteResult's GoalView is HOST truth — apply it now so the
				// chip's phase and CAS ref are fresh before the next poll (a
				// quick second action then carries the new revision, not the
				// stale one the host would honestly refuse).
				const view = parseGoalView((body as { value?: unknown }).value);
				if (view !== undefined) store.applyGoal(view);
				if (verb === 'edit') goalEditor = null;
				noteCommand('ok', `goal ${verb}`);
			} else {
				noteCommand('error', body?.error?.message ?? `goal ${verb} failed`);
			}
		} catch (err) {
			noteCommand('error', `goal ${verb} failed (${err instanceof Error ? err.message : String(err)})`);
		} finally {
			goalBusy = false;
		}
	}

	// ── Goal editor state (Goal Editor ADR D2/D4) — panel-owned; GoalBar
	// renders the fields and emits callbacks. ─────────────────────────────
	let goalEditor = $state<{ objective: string; maxGoalRounds: number } | null>(null);

	/** Open the editor, pre-filled from the CURRENT projection. */
	function openGoalEditor(): void {
		const goal = store.goal;
		if (goal === null || goal === undefined) return;
		goalEditor = { objective: goal.objective, maxGoalRounds: goal.maxGoalRounds };
	}

	/** One form field changed — update the panel-owned editor state. */
	function editGoalField(field: 'objective' | 'maxGoalRounds', value: string): void {
		if (goalEditor === null) return;
		if (field === 'objective') goalEditor.objective = value;
		else {
			const parsed = Number(value);
			goalEditor.maxGoalRounds = Number.isFinite(parsed) ? parsed : goalEditor.maxGoalRounds;
		}
	}

	/** Diff the editor against the CURRENT store goal at submit time (ADR
	 *  D3 — a model-side edit between form-open and submit must not be
	 *  clobbered by an untouched prefill) and submit the changed fields. */
	function submitGoalEditor(): void {
		const goal = store.goal;
		const editor = goalEditor;
		if (editor === null || goal === null || goal === undefined) return;
		const objective = editor.objective.trim();
		const changed: { objective?: string; maxGoalRounds?: number } = {};
		if (objective.length > 0 && objective !== goal.objective) changed.objective = objective;
		const rounds = Number(editor.maxGoalRounds);
		if (Number.isSafeInteger(rounds) && rounds >= 1 && rounds !== goal.maxGoalRounds) {
			changed.maxGoalRounds = rounds;
		}
		if (changed.objective === undefined && changed.maxGoalRounds === undefined) {
			noteCommand('error', 'nothing changed — edit the objective or the round cap');
			return;
		}
		void runGoalVerb('edit', changed);
	}

	/** The executor context this panel's commands run under — live prop
	 *  values read at call time (the /new successor swap may change them
	 *  between one run's lines and the next). */
	function executorCtx() {
		return { sessionId, workspace, agent, panelId, entries: store.entries };
	}

	// ── Slash Menu wiring (Slash Menu ADR, 2026-08-30; task 2.3) ────────
	/** This panel's view of the session's host catalog — component state,
	 *  so menu state DIES with the panel (no cross-panel leakage; the
	 *  strip precedent). The cache itself is the module-level
	 *  slash-directory store; this holds only the reactive read. */
	let slashCatalog = $state<SlashDirectory | null>(null);

	/** The composer's re-query bridge (fires while the menu is open-shaped
	 *  and the query moved — never on mount, so a cold session is woken
	 *  only when the operator actually opens the menu, ADR §3.3). A plain
	 *  re-read: a no-op map lookup while the cache is ready; the
	 *  single-flight fetch kick on first open, after a failure, and on
	 *  the retry read. Write-only on purpose — reading the guarded state
	 *  here would put it inside the caller's effect and loop it. */
	function onslashopen(): void {
		slashCatalog = directoryFor(sessionId);
	}

	/** Menu command pick: the SAME rung the ladder uses (one execution
	 *  surface, D2), banner notes through the shared note path; the
	 *  boolean admits the composer's draft clearing (BC-A3). */
	async function onpickcommand(line: string): Promise<boolean> {
		const result = await executeHostCommand(line, executorCtx(), (ok, note) =>
			noteCommand(ok ? 'ok' : 'error', note)
		);
		return result.ok;
	}

	/**
	 * ADR-0007 R5 (fixed 2026-08-25) — submit one access-mode pick through
	 * the typed route onto the NATIVE commands/execute wire. Boolean result
	 * for the chip (it owns the optimistic label + the disabled-until-
	 * confirmed state; the poll's knob events are the confirmation).
	 */
	async function onpermission(preset: string): Promise<boolean> {
		try {
			const res = await fetch(`/api/dsh/session/${encodeURIComponent(sessionId)}/permission`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ line: `/permission ${preset}` })
			});
			const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
			return res.ok && body?.ok === true;
		} catch {
			return false;
		}
	}

	/** POC-3 W2 (task 2.3): answer a pending approval/question via the carrier.
	 * A failed delivery is never silent: the card returns to answerable
	 * (orchestrator released the lock) and the failure banner names why —
	 * the user's only alternative was clicking Answer into a void. */
	async function onanswer(rpcId: string, payload: Record<string, unknown>): Promise<void> {
		const result = await orchestrator.respond(rpcId, payload);
		if (!result.ok) {
			store.setError(
				`Answer not delivered — ${result.reason ?? 'unknown reason'}. The question stays answerable; try again.`
			);
		}
	}

	// ── POC-3 W3 (3.1): header inline rename ────────────────────────────────
	/** Title truth: cold-load projections seed, rename receipt updates. A
	 * failed rename reverts to this — the old title is the honest state.
	 * Intentional initial capture: the title seeds from the COLD LOAD and
	 * is then panel-owned (rename receipts update it); a later data swap
	 * must not clobber an in-flight edit. svelte-ignore state_referenced_locally */
	// svelte-ignore state_referenced_locally
	let title = $state(initialTitleProp);

	// ── Live title healing (2026-08-24 header bug): the sidebar row heals
	// its title from the 5s spine refresh, but the panel header kept the
	// ONE-SHOT cold value — a session the host names only AFTER the panel
	// opened (first-turn auto-title) showed the id prefix forever. The
	// `title` prop is now the spine-healed LIVE value; every external
	// change is adopted EXCEPT while a local rename awaits its host echo
	// (plain let on purpose: the guard must not re-run the effect).
	let unechoedRename: string | null = null;

	$effect(() => {
		const ext = initialTitleProp;
		if (unechoedRename !== null) {
			if (ext === unechoedRename) {
				unechoedRename = null; // host echoed — external truth again
				title = ext;
			}
			return; // host not caught up — keep the local rename on screen
		}
		title = ext;
	});

	/** Pending (non-terminal) answer views — the live cards above the input. */
	const pendingCards = $derived(
		store.answerList.filter((a) => a.phase === 'waiting' || a.phase === 'in-flight')
	);

	/** Explanatory terminal cards — the RARE endings that owe the user an
	 *  explanation for why the card stopped being answerable: a lost race
	 *  (answered elsewhere) or a cancelled turn (withdrawn). Our OWN
	 *  settled answer is NOT kept: the receipt, the agent's reply, and the
	 *  transcript chip's QuestionBlock are the record — the card unmounts
	 *  the moment its settlement lands (2026-08-24 fix: the dimmed copy
	 *  used to linger until a manual refresh, which is exactly what a
	 *  refresh shows anyway — nothing). Terminal records stay in the
	 *  store's map (anti-resurrection guard); only this render drops them. */
	const settledCards = $derived(
		store.answerList.filter(
			(a) => a.phase === 'answered-elsewhere' || a.phase === 'withdrawn'
		)
	);

	/** Attachment refusals render at the COMPOSER (2026-08-26): the
	 * drafts they rejected are still attached right there (BC-A3), so
	 * the answer belongs beside them — not one screen up in the
	 * transcript-top banner. One home per error: the top banner keeps
	 * everything else (agent-busy, transport). */
	const composerError = $derived(
		store.error !== null && store.error.code === 'attachment-error' ? store.error : null
	);
	const topError = $derived(
		store.error !== null && store.error.code !== 'attachment-error' ? store.error : null
	);

	/** Context consumption (2026-08-23): the LAST assistant usage record
	 * across the ledger — what the most recent model request consumed
	 * (uncached input + cache-read + cache-write = the full prompt seen).
	 * Wire truth via DsiTokenUsage; undefined until a turn finalizes. */
	const contextTokens = $derived.by(() => {
		for (let i = store.entries.length - 1; i >= 0; i--) {
			const e = store.entries[i];
			if (e.kind === 'assistant-message' && e.usage !== undefined) {
				return e.usage.inputTokens + (e.usage.cacheReadTokens ?? 0) + (e.usage.cacheWriteTokens ?? 0);
			}
		}
		return undefined;
	});

	/** Context window limit (OCI percentage parity, 2026-08-24): the DSH
	 * wire reports usage but NO window, so the limit resolves client-side
	 * from the session's current model id via the local catalog (+ user
	 * overrides in dsi-ctx-windows). Unknown model → undefined → the
	 * footer keeps its honest "≈Nk ctx" no-limit label. */
	let currentModel = $state<string | undefined>(undefined);
	const totalContextLimit = $derived(contextWindowOf(currentModel));

	/** Session baseline (ADR 2026-09-08 "The Stats Bar", D2): this
	 * panel's own pure fold over the ledger entries — turns, steps,
	 * tool time, token totals, cache hit. Null before the first
	 * assistant message (D5: an empty session renders no bar).
	 *
	 * conversation.statsBar 'full-ledger' (the default) replaces this
	 * with the host's whole-log ledger stats (sessionStats + tokenUsage
	 * projections) — the same totals DSH shows, counted over the entire
	 * log including cancelled/failed steps and billed cache input. When
	 * the host pair has not landed (or the mode is 'partial') the
	 * partial fold above stays the honest display. */
	const sessionStats = $derived(
		appConfig().conversation.statsBar === 'full-ledger' &&
		store.ledgerStats !== null &&
		store.ledgerStats.steps > 0
			? statsFromLedger(store.ledgerStats)
			: deriveSessionStats(store.entries)
	);

	// ── Prompt Macro wiring (ADR "The Prompt Macro", 2026-08-29; W2 2.2) ─
	// The runner is module-scope (survives the /new swap by design, D3);
	// THIS panel owns: the start context and the poll truth the sheet
	// reads (running/pendingAnswers — D7: the runner never polls). Chip
	// OWNERSHIP follows the run's target session (2026-08-29 addendum
	// remediation): the /new swap mints a fresh panel id and remounts
	// this component, so a panelId anchor would die mid-run — the runner
	// holds targetSessionId + the ✓/▶ baseline instead, and whichever
	// panel shows that session renders the sheet.

	/** The runner's reactive state — module scope; reading it inside a
	 *  $derived re-renders the sheet when the feeder advances. */
	const macroRun = $derived(macroRunState());

	/** Live assistant-turn group count of the panel's OWN store (the
	 *  transcript's existing prompt↔turn pairing — groupTurns). */
	const assistantTurnCount = $derived(groups.filter((g) => g.kind === 'assistant-turn').length);

	/** Panel-derived landed turns for the sheet: the live count above the
	 *  runner-held baseline of THIS panel's session (clamped at 0). After
	 *  a /new retarget the baseline is 0 against a fresh, empty store —
	 *  every turn that lands is one of the run's, exactly. */
	const macroLanded = $derived(
		macroRun.targetSessionId === sessionId
			? Math.max(0, assistantTurnCount - macroRun.baselineTurns)
			: 0
	);

	/** The sheet renders on the panel showing the run's TARGET session —
	 *  the birth-panelId anchor died at the /new swap (fresh id + remount);
	 *  the successor panel claims the run by session instead. */
	const macroOurs = $derived(macroRun.phase !== 'idle' && macroRun.targetSessionId === sessionId);

	/** Composer run-accept: start the accepted shelf row (`!` mode only —
	 *  find mode stays insert-only, task 2.1). */
	function onrunmacro(index: number): void {
		const row = stripRowsMirror[index];
		if (!row) return;
		startMacro(row, false);
	}

	/** Composer ⏯ Step: same start, HELD — the supervised path (D10). */
	function onstep(index: number): void {
		const row = stripRowsMirror[index];
		if (!row) return;
		startMacro(row, true);
	}

	/** Mirror of the composer's strip rows — refreshed via PromptInput's
	 *  onrows callback (props-only contract kept: the panel never reaches
	 *  into the component's internals). The accepted index resolves
	 *  against the rows the strip showed at accept time. */
	let stripRowsMirror: Array<{ text: string; id: number }> = [];

	/** Start (or refuse) a run in THIS panel's context; the ✓/▶ baseline
	 *  (this store's assistant-turn count) rides to the RUNNER at start —
	 *  runner-held, so the derivation survives the /new remount (GAP-1:
	 *  the panel's own store, option b). */
	function startMacro(row: { text: string; id: number }, held: boolean): void {
		const result = macroRunner.start(
			row,
			{ sessionId, workspace, agent, panelId, entries: store.entries },
			{ held, baselineTurns: assistantTurnCount }
		);
		// A refused start (live run / empty or over-cap row) returns a state
		// with a note — surface it on the panel's banner so the refusal is
		// VISIBLE (one-run-at-a-time + fail-loud, D6).
		if (result.phase === 'failed') {
			noteCommand('error', result.note ?? 'macro refused');
			return;
		}
		if (result.note !== null && result.note.includes('already running')) {
			noteCommand('error', result.note);
		}
	}
</script>

<svelte:head>
	<!-- i18n-skip: brand suffix, never translated -->
	<!-- Optional-chained (2026-09-18): probe-mounted floors render with NO
	     session yet — a bare sessionId.slice crashed the tree unhandled. -->
	<title>{(title ?? (sessionId ? sessionId.slice(0, 12) + '…' : 'deepseek-insight'))}</title>
</svelte:head>

<!-- overflow: auto (Panel Floor, W3): inside PanelColumn's COLUMN-flex
     .body the flex root would otherwise refuse to shrink below content
     (min-height: auto) and overflow: hidden clips the tail — a scroll
     container root bounds the height so the inner ConversationScrollArea
     owns the scrolling again. (The old page's row-flex h-dvh wrapper
     bounded it implicitly; the column embedding needs this.)
     `relative` (2026-08-24, OCI Floating Host discipline): the
     positioned ancestor for the embedded FloatingAnchor — the stack's
     absolute right-middle resolves against THIS panel's box, per panel. -->
<div class="relative flex min-w-0 flex-1 flex-col overflow-auto">
	<ConversationHeader
		{sessionId}
		{title}
		initialTitle={initialTitleProp}
		ontitlechange={(t) => {
			title = t;
			// Optimistic local rename (echo guard): the spine still carries
			// the old title for up to one tick — keep the local truth on
			// screen until the external prop echoes it back.
			unechoedRename = t;
		}}
		{workspace}
		{workspaces}
		access={store.permission?.current ?? null}
		agent={agentDisplay ?? agent}
		agentId={agent}
		isStreaming={store.isStreaming}
		transcript={viewport}
		{subagent}
		plan={store.planMode}
		{parentSessionId}
		{focused}
		{onOpenExplorer}
	/>

	<ConversationError error={topError} />

	<ConversationScrollArea
		bind:viewport
		bind:stick
		entries={store.entries}
		{groups}
		hasMore={hasOlder}
		{loadingOlder}
		{olderError}
		onloadolder={() => void loadOlder()}
		{openChipId}
		ontogglechip={toggleChip}
		{autoThinkId}
		{autoPlanId}
		{peekOpenRunKey}
		ontogglepeek={togglePeek}
		{pendingCards}
		{settledCards}
		onanswer={(rpcId, payload) => void onanswer(rpcId, payload)}
		onFileLink={onFileLink}
			sessionId={store.sessionId}
		{title}
		agentPreset={agent}
		{subagent}
		{depth}
	/>

	<ConversationFloatingAnchor
		{groups}
		container={viewport}
		todos={store.todos ?? null}
		onloadall={() => loadAllOlder()}
		onleavebottom={() => onStickToggle(false)}
		shelfentries={store.entries}
		shelfsessionid={sessionId}
		shelfworkspace={workspace}
		shelfpanelid={panelId}
		onshelfnote={(ok, note) => noteCommand(ok ? 'ok' : 'error', note)}
	/>

	<!-- W4 4.2: the sender panel's a2a delegation chips — read-only join of
	     its ledger rows (state VERBATIM, replied_approx hedged), on the
	     floating-anchor pattern beside the transcript. -->
	<A2aChipStack rows={a2aRows} titles={a2aTitles} />

	<!-- Slash-command feedback (2026-08-25, OCI banner pattern): the host's
	     own reply text for /permission; /new's failures. 5s auto-dismiss. -->
	{#if commandNote !== null}
		<div
			class="command-note"
			class:command-note-error={commandNote.kind === 'error'}
			data-testid="command-note"
			role="status"
		>
			{commandNote.text}
		</div>
	{/if}

	<!-- Attachment-refusal note (2026-08-26): directly ABOVE the composer —
	     the rejected drafts are still attached right below it (BC-A3). No
	     auto-dismiss: the note is the actionable state (remove the images or
	     switch model) and clears with the next submit attempt. -->
	{#if composerError !== null}
		<div class="command-note command-note-error composer-error" data-testid="composer-error" role="alert">
			<span>{composerError.message}</span>
			{#if composerError.reason === 'MODEL_DOES_NOT_SUPPORT_IMAGES'}
				<span class="composer-error-hint">
					{t(m.imagesKeptHint)}
				</span>
			{/if}
		</div>
	{/if}

	<!-- Session baseline (ADR "The Stats Bar", D4): the numbers line sits
	     OUTSIDE the sub-agent fence — above composer-area on agent panels,
	     the bottom in-flow row on sub-agent panels. The fence gates
	     prompting, not reading; the bar is read-only. -->
	<ConversationStatsBar stats={sessionStats} />

	<!-- Sub-agent fence (2026-08-27): the host's subagent routing owns the
	     child's turn pipe — session.prompt/updateQueue/cancel reject
	     `agent-busy` — so a sub-agent panel mounts NO composer at all;
	     the transcript above is the whole surface (read + approve there
	     still flows through the answerer cards when the host allows). -->
	{#if !subagent}
		<!-- Macro run sheet (Prompt Macro D7/D9, 2026-08-29): chip + sheet
	     directly above the composer — the command-note banner's spot. The
	     sheet renders only on the panel that started the run; poll truth
	     (store.running, pending cards) and the ✓/▶ derivation baseline are
	     THIS panel's own store — no spine fetch, no new plumbing. -->
		{#if macroOurs}
			<MacroRunSheet
				run={macroRun}
				landedTurns={macroLanded}
				running={store.isStreaming}
				pendingAnswers={pendingCards.length}
				onfeednext={() => void macroRunner.feedNext()}
				onrunall={() => void macroRunner.runAll()}
				onabort={() => macroRunner.abort()}
				onrunagain={() => macroRunner.runAgain({ baselineTurns: assistantTurnCount })}
				onclose={() => macroRunner.dismiss()}
			/>
		{/if}
		<!-- Goal bar (ADR "The Goal Bar", 2026-09-08): chip + sheet in the
	     same composer dock, beside the macro sheet. The goal value is
	     THIS panel's store projection; actions ride the host's goals/*
	     Remotes with the CAS ref (paperwork stays silent). -->
		<GoalBar
			goal={store.goal}
			onpause={() => void runGoalVerb('pause')}
			onresume={() => void runGoalVerb('resume')}
			onclear={() => void runGoalVerb('clear')}
			onedit={openGoalEditor}
			editor={goalEditor}
			oneditinput={editGoalField}
			oneditsubmit={submitGoalEditor}
			oneditcancel={() => (goalEditor = null)}
		/>
		<!-- Agent panels (2026-09): the stick toggle floats bottom-right
	     OVER the transcript's bottom edge, directly above the composer —
	     absolutely positioned so it costs the scroll viewport zero
	     height. Same stick state + panel handler. -->
		<div class="composer-area">
			{#if agent !== null}
				<div class="composer-stick" data-testid="composer-stick-toggle">
					<StickToBottomToggle {stick} ontoggle={onStickToggle} />
				</div>
			{/if}
			<ConversationFooter
				{onsubmit}
				{oncancel}
			isStreaming={store.isStreaming}
			sending={submitted}
			{sessionId}
			{contextTokens}
			{totalContextLimit}
			permission={store.permission}
			{onpermission}
			imageLimits={store.imageLimits ?? imageLimits}
			onrunmacro={onrunmacro}
			onstep={onstep}
			onrows={(rows) => (stripRowsMirror = rows)}
			{slashCatalog}
			{onslashopen}
			{onpickcommand}
			focusOnMount={focusComposer}
			onfocused={() => oncomposerfocus?.()}
				{focused}
		/>
		</div>
	{/if}

	<!-- Floating stick-to-bottom toggle (2026-09): sub-agent panels mount
	     no composer, so the toggle gets a floating bottom-right mount of
	     its own — same stick state + panel handler. Positioned against the
	     panel root (the scroll happens inside ConversationScrollArea's
	     viewport, so this does not scroll away). -->
	{#if subagent}
		<div class="floating-stick" data-testid="floating-stick-toggle">
			<StickToBottomToggle {stick} ontoggle={onStickToggle} />
		</div>
	{/if}
</div>

<style>
	.command-note {
		margin: 0 0.5rem 0.25rem;
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		font-size: 0.75rem;
		background: rgba(16, 185, 129, 0.12);
		color: #047857;
	}
	.command-note-error {
		background: rgba(239, 68, 68, 0.12);
		color: #b91c1c;
	}
	.composer-error {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.composer-error-hint {
		opacity: 0.85;
	}
	.composer-area {
		position: relative;
	}
	.composer-stick {
		position: absolute;
		right: 0.5rem;
		bottom: 100%;
		margin-bottom: -2rem;
		z-index: 20;
	}
	.floating-stick {
		position: absolute;
		right: 0.5rem;
		bottom: 1.75rem;
		z-index: 20;
		background: var(--color-surface, #fff);
		border-radius: 8px;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
		padding: 0.125rem;
	}
</style>
