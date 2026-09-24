<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { onMount } from 'svelte';
	import TokenCounter from '$lib/components/chat/TokenCounter.svelte';
	import ContextConsumption from '$lib/components/chat/ContextConsumption.svelte';
	import ModelSelector from '$lib/components/chat/ModelSelector.svelte';
	import AccessModeChip from '$lib/components/chat/AccessModeChip.svelte';
	import StreamingIndicator from '$lib/components/chat/StreamingIndicator.svelte';
	import AttachmentManager from '$lib/components/chat/AttachmentManager.svelte';
	import AttachmentChips from '$lib/components/chat/AttachmentChips.svelte';
	import type { AttachmentDraft, SerializedImage } from '$lib/services/chat/attachment-service.svelte';
	import { DEFAULT_IMAGE_LIMITS } from '$lib/services/conversation/image-limits';
	import { appConfig, loadAppConfig } from '$lib/services/config/app-config.svelte';
	import { ArrowUp, Square, SquareCheck } from '@lucide/svelte';
	import SuggestStrip from './suggest-strip/SuggestStrip.svelte';
	import PromptInputText from './PromptInputText.svelte';
	import CommandHelpCard from '../card/CommandHelpCard.svelte';
	import SlashMenu, { slashMenuMatches } from './SlashMenu.svelte';
	import PromptsManagerDialog from '../prompt-manager/PromptsManagerDialog.svelte';
	import {
		getTrigger,
		searchKey,
		triggerMode,
		type SuggestedPrompt
	} from '$lib/services/chat/prompt-trigger.js';
	import {
		commandHelpTopic,
		gestureHelpCardView,
		helpQuery,
		hostHelpCardView,
		MENU_GESTURES
	} from '$lib/services/chat/command-help';
	import { parseCommand } from '$lib/services/chat/command-parser';
	import type { SlashDirectory } from '$lib/services/chat/slash-directory.svelte';
	import { clearDraft, loadDraft, saveDraft } from '$lib/utils/draft-prefs';
	import {
		isSyncChecked,
		mirrorTextFor,
		registerSyncMember,
		setSyncChecked,
		type SyncSlashView,
		type SyncStripView
	} from '$lib/services/chat/prompt-sync.svelte';
	import { getLensMode } from '$lib/services/conversation/lens-context.svelte';

	/**
	 * PromptInput — the send surface (PRD §3.4: input → Cancel/dots UX).
	 *
	 * Contract (BC-3 + rapid double-submit lock):
	 *   - Enter submits, Shift+Enter newlines
	 *   - sending=true (awaiting the receipt): textarea + button locked
	 *   - isStreaming=true (turn running): Send flips to red Cancel
	 *   - empty text never submits
	 *
	 * Command help (command-help, 2026-08-30): a draft that is a known
	 * command with `?` as its entire first argument (`/new ?`,
	 * `/permission ?`, `@<session-id> ?`) opens the CommandHelpCard above
	 * the textarea; Enter never sends a `?` line, Esc hides the card.
	 *
	 * Slash Menu (ADR "The Slash Menu", 2026-08-30): the THIRD floating
	 * surface. A `/`-draft the parser DECLINES opens the two-section host
	 * vocabulary (parser stand-down — gesture drafts never open it);
	 * Enter/arrows intercept only while filter-matching rows exist, else
	 * Enter falls through to submit (the strip's row-gated guard). Kind-
	 * aware picks: hint-less commands execute via onpickcommand (BC-A3
	 * boolean), hint commands and skills land `/name ` — the operator's
	 * Enter is press 2. Catalog state rides props (onslashopen bridge);
	 * this component never fetches and never wakes a cold session.
	 *
	 * Auto-grow (OCI pattern, 2026-08-23): the textarea fits its content
	 * and clamps at MAX_ROWS rows — height = min(scrollHeight,
	 * MAX_ROWS × lineHeight), measured from the live element (no magic
	 * pixel constants). Past the clamp the box scrolls instead of growing.
	 *
	 * Config (2026-08-25, OCI ~/.openclaw-insight pattern): MAX_ROWS starts
	 * at the default 15 and re-clamps when ~/.dsi/settings.yaml
	 * `chat.input.maxRows` arrives (GET /api/config, singleton load shared
	 * by every panel — reading it in the auto-grow effect re-measures on
	 * arrival).
	 *
	 * Info row (OCI ChatInput pattern, 2026-08-23) under the textarea:
	 *   TokenCounter + AccessModeChip (left) · ModelSelector (center) ·
	 * ContextConsumption (right). The selector opens upward (menuUp) — a
	 * downward menu would clip off the page bottom. All members are
	 * optional: the row renders only when something is in it, and each
	 * member hides itself without data.
	 *
	 * Access chip (ADR-0007, 2026-08-25): the left flank mirrors DSH's
	 * composer grammar (access mode beside the turn-shaping controls,
	 * context opposite) — "about the input you're about to send". The
	 * chip hides without `permission` or `onpermission`. Mid-flight it
	 * stays USABLE (2026-08-28): a running turn never locks it (DSH
	 * parity — the pick is a host-side command, independent of the
	 * turn); only the submit window does.
	 *
	 * Draft persistence (2026-08-30, HMR DX): the draft saves debounced to
	 * `localStorage['dsi-draft_<sessionId>']` (draft-prefs) while typing
	 * and is the composer's INITIAL value at the next mount with the
	 * caret at the end — an HMR strike or reload mid-typing no longer
	 * wipes it. An unmount inside the debounce window flushes the tail;
	 * blur flushes with focused=false; send, macro run-accept, and any
	 * emptied draft clear the stored entry synchronously.
	 *
	 * Presentational: state arrives via props, intents leave via callbacks.
	 */
	interface Props {
		/** Resolves false when nothing was admitted (W2 failure path):
		 *  drafts survive a rejected send (BC-A3). Any other result clears.
		 *  Wave 2: images arrive serialized at submit (serialize-at-submit,
		 *  BC-A2) — the only moment base64 exists in the composer. */
		onsubmit: (text: string, images: SerializedImage[]) => boolean | Promise<boolean>;
		oncancel: () => void | Promise<void>;
		isStreaming: boolean;
		sending: boolean;
		/** Session id — mounts the ModelSelector in the info row's center. */
		sessionId?: string;
		/** Context tokens consumed by the last model request (wire usage). */
		contextTokens?: number;
		/** Model context window size — absent on the DSH wire today. */
		totalContextLimit?: number;
		/** Access-mode read state (ADR-0007); null/absent hides the chip. */
		permission?: import('$lib/services/conversation/permission-state').DsiPermission | null;
		/** Submit one preset pick (the panel POSTs the /permission line). */
		onpermission?: (preset: string) => Promise<boolean> | boolean;
		/** Host admission numbers (imageLimits projection, task 4.2) —
		 *  drives the picker accept list, pre-flight, and drop copy. */
		imageLimits?: import('$lib/services/conversation/image-limits').DsiImageLimits;
		/** Prompt Macro (ADR "The Prompt Macro", 2026-08-29): `!` accept is
		 *  find-and-RUN — Enter/Tab/click on a strip row fires this with the
		 *  highlighted index instead of inserting text. Absent = run mode
		 *  falls back to insert (the component never imports the runner —
		 *  presentational contract, D7). */
		onrunmacro?: (index: number) => void;
		/** ⏯ Step on a strip row (run mode): start the run HELD — the
		 *  supervised path (D10). Absent hides the Step buttons. */
		onstep?: (index: number) => void;
		/** Prompt Macro (W2 2.2): the panel mirrors the strip rows to
		 *  resolve accepted indices into row text/id at accept time — the
		 *  composer reports its own state (presentational contract kept;
		 *  the panel never reaches into the component). */
		onrows?: (rows: SuggestedPrompt[]) => void;
		/** Slash Menu (ADR "The Slash Menu", 2026-08-30): the session's
		 *  cached host catalog + lifecycle, bridged from the panel — the
		 *  component never fetches (props-only, the MacroRunSheet rule);
		 *  null/absent renders the menu's loading row until the bridge
		 *  lands the first read. */
		slashCatalog?: SlashDirectory | null;
		/** Fired while the menu is open-shaped and its query moved (the
		 *  open included): the panel re-reads directoryFor — a no-op map
		 *  read while cached, the single-flight fetch kick on first open.
		 *  Never fires closed, so a panel mount wakes nothing (ADR §3.3). */
		onslashopen?: () => void;
		/** Execute a picked hint-less host command: the FULL line rides
		 *  the command route; the boolean admits draft clearing (BC-A3 —
		 *  false keeps the draft, the honest note is the receipt). */
		onpickcommand?: (line: string) => boolean | Promise<boolean>;
		/** Pick a hint-carrying command row — the composer lands `/name `
		 *  (press 2 sends); the panel is informed for symmetry. */
		onpickcommandwithhint?: (name: string) => void;
		/** Pick a skill row — the composer lands `/name `; the operator's
		 *  own Enter is press 2 (the two-press rule, never auto-sent). */
		onpickskill?: (name: string) => void;
		/** Focus the textarea once at mount (the /new swap-focus, 2026-08-29):
		 *  the floor marks a panel the operator just retargeted, and the
		 *  fresh composer takes the caret. Absent/false (every ordinary
		 *  mount — page load, restored desk) never steals focus. */
		focusOnMount?: boolean;
		/** Fired once after the mount focus landed — the floor clears its
		 *  one-shot marker on it (a panel that never mounts, e.g. a dead
		 *  session's error card, leaves the marker inert). */
		onfocused?: () => void;
	}

	let {
		onsubmit,
		oncancel,
		isStreaming,
		sending,
		sessionId,
		contextTokens,
		totalContextLimit,
		permission = null,
		onpermission = undefined,
		imageLimits = undefined,
		onrunmacro = undefined,
		onstep = undefined,
		onrows = undefined,
		slashCatalog = null,
		onslashopen = undefined,
		onpickcommand = undefined,
		onpickcommandwithhint = undefined,
		onpickskill = undefined,
		focusOnMount = false,
		onfocused = undefined
	}: Props = $props();

	// ── Draft persistence (HMR/reload DX, 2026-08-30) ──
	/** Restored draft, read ONCE at init: the script body re-runs on every
	 *  HMR remount, so the saved text is the composer's INITIAL state —
	 *  in place before any effect (including the save watcher below) can
	 *  run. SSR reads no localStorage and restores nothing. */
	// Intentional initial capture: the panel floor keys panels by sessionId
	// (a session change remounts rather than re-initializes), so the draft
	// belongs to the mount's one session.
	// svelte-ignore state_referenced_locally
	const restoredDraft = sessionId !== undefined ? loadDraft(sessionId) : null;
	// svelte-ignore state_referenced_locally
	let value = $state(restoredDraft?.text ?? '');

	// Lens flag (The Panel Loupe ADR D8, 2026-09-04), read ONCE at init —
	// the same read point as the draft above: a composer only ever remounts
	// per surface, never flips surfaces live. True inside the loupe: the
	// prompt-sync check renders visible-disabled, because the broadcast
	// membership it toggles is keyed by session id — a live second check
	// would be control-at-a-distance over the floor column's membership.
	const lens = getLensMode();
	/** In-flight submit awaiting its receipt (component-owned lock, BC-3). */
	let awaiting = $state(false);

	/** Debounced draft-save timer (non-reactive — scheduling detail). */
	let draftTimer: ReturnType<typeof setTimeout> | null = null;
	/** Whether the textarea owned the caret at the last focus/blur — the
	 *  flag, not a live DOM read, is what a teardown-time flush saves
	 *  (an element removed mid-HMR fires no blur). */
	let textareaFocused = false;
	/** Long enough to ride a typing burst; short enough that an HMR
	 *  strike loses at most this window (the teardown flush covers the
	 *  tail anyway). */
	const DRAFT_DEBOUNCE_MS = 400;

	// Debounced save while typing; an emptied draft clears SYNCHRONOUSLY —
	// send / macro run-accept must never let a submitted prompt resurrect
	// from storage.
	$effect(() => {
		if (sessionId === undefined) return;
		const text = value;
		if (draftTimer !== null) clearTimeout(draftTimer);
		draftTimer = null;
		if (text.length === 0) {
			clearDraft(sessionId);
			return;
		}
		draftTimer = setTimeout(() => {
			draftTimer = null;
			saveDraft(sessionId, text, textareaFocused);
		}, DRAFT_DEBOUNCE_MS);
	});

	// Teardown flush — no reactive reads in the body, so this runs ONCE
	// at unmount: an HMR strike (or panel close) inside the debounce
	// window still persists the tail, and the remount's restore picks it
	// up. The closure reads the CURRENT value/flag at teardown time.
	$effect(() => {
		return () => {
			if (draftTimer !== null) clearTimeout(draftTimer);
			draftTimer = null;
			if (sessionId !== undefined && value.length > 0) {
				saveDraft(sessionId, value, textareaFocused);
			}
		};
	});

	/** Draft attachments (task 1.5): the Manager owns the service; the
	 *  chips row, the enable rule, and the submit payload read the mirror. */
	let attachmentMgr = $state<AttachmentManager>();
	let drafts = $state<AttachmentDraft[]>([]);

	const locked = $derived(sending || awaiting);
	const disabled = $derived(
		locked || (isStreaming ? false : value.trim().length === 0 && drafts.length === 0)
	);

	// ── Prompt Sync (ADR "The Prompt Sync", 2026-09-04) ──
	/** The checkmark's state — this session's membership in the sidebar
	 *  broadcast (the store is the one owner; the button only flips it). */
	const syncChecked = $derived(sessionId !== undefined && isSyncChecked(sessionId));

	// ── Suggest Strip state (ADR "The Suggest Strip", Wave 2) ──
	/** Rows fetched for the live "?" query — strip-only (no ghost, ADR §6). */
	let suggestRows = $state<SuggestedPrompt[]>([]);
	/** Highlighted row in the strip (arrows wrap, Tab/Enter accept). */
	let stripIndex = $state(0);
	/** Live trigger query the rows belong to — threads to the strip for
	 *  fragment highlighting (F4). Empty = plain rows. */
	let stripQuery = $state('');
	/** 120 ms debounce timer (non-reactive — scheduling detail). */
	let suggestTimer: ReturnType<typeof setTimeout> | null = null;
	/** Out-of-order response guard: only the newest fetch may write rows. */
	let suggestSeq = 0;
	/** Query the user explicitly rejected (Esc): the debounced refetch
	 *  never resurrects it; typing one more character unlocks it. */
	let dismissedQuery: string | null = null;
	/** IME composition state — suggest keys pass through while composing
	 *  (BC-8); composition input events skip the debounce too. */
	let isComposing = $state(false);

	// ── Command help card (command-help, 2026-08-30) ──
	/** Live help topic for the draft — non-null while the text is a known
	 *  DSI gesture with `?` as its entire first argument (`/new ?` …).
	 *  Derived from the whole value: the help intent is a whole-line
	 *  shape, never caret-positioned (unlike the finder's trigger). */
	const helpTopic = $derived(commandHelpTopic(value));
	/** Host-vocabulary help (2026-08-30 extension): a declined `/token ?`
	 *  draft resolved against the SAME cached catalog the menu reads —
	 *  the card renders the wire's own copy, DSI invents nothing. Null
	 *  while the catalog is idle/loading/failed or the token is unknown;
	 *  the card's absence is then the honest answer (an unresolved `?`
	 *  line rides the ladder like any unknown text). */
	const hostHelp = $derived(
		slashCatalog !== null && slashCatalog.state === 'ready'
			? hostHelpCardView(value, slashCatalog.commands, slashCatalog.skills)
			: null
	);
	/** Any `?`-shaped draft (DSI gesture or host row) — the menu stands
	 *  down while a question is on the line, resolved or not. */
	const helpShape = $derived(helpTopic !== null || helpQuery(value) !== null);
	/** Esc memo: hide while the text keeps matching; any edit re-arms. */
	let helpDismissed = $state(false);
	$effect(() => {
		if (helpTopic === null && hostHelp === null) helpDismissed = false;
	});
	const helpVisible = $derived((helpTopic !== null || hostHelp !== null) && !helpDismissed);
	/** The card's view — the gesture copy, else the host row's own. */
	const helpView = $derived(
		helpTopic !== null ? gestureHelpCardView(helpTopic) : hostHelp !== null ? hostHelp : null
	);

	// ── Prompts Manager (Wave 3, ADR E4): opened from the strip's ⚙ row ──
	let managerOpen = $state(false);
	/** Portal host for the manager modal — appended to document.body so the
	 *  modal's position:fixed escapes the panel floor's CSS zoom (BC-7). */
	let mgrPortal = $state<HTMLDivElement | undefined>();

	$effect(() => {
		if (!mgrPortal) return;
		const el = mgrPortal; // capture: bind:this nulls before cleanup runs
		document.body.appendChild(el);
		return () => {
			el.remove();
		};
	});

	const SUGGEST_DEBOUNCE_MS = 120;
	/** API search-mode limit clamp is 10 (W1 GET contract). */
	const SUGGEST_MAX_RESULTS = 10;

	/** Live query from the DOM — always read at decision points (keydown,
	 *  accept, close): caret position is not reactive state. */
	function liveQuery(): string | null {
		const el = textareaEl;
		return getTrigger(el?.value ?? value, el?.selectionStart ?? value.length);
	}

	/** Debounced search against GET /api/prompts?mode=contains (BC-3: DSI-local). */
	function scheduleSuggest(): void {
		if (suggestTimer) clearTimeout(suggestTimer);
		suggestTimer = setTimeout(fetchSuggestions, SUGGEST_DEBOUNCE_MS);
	}

	async function fetchSuggestions(): Promise<void> {
		const el = textareaEl;
		// ALWAYS read live state — a stale timer may fire after user edits.
		const caret = el?.selectionStart ?? value.length;
		const current = el?.value ?? value;
		const query = getTrigger(current, caret);
		if (!query) {
			suggestRows = [];
			return;
		}
		if (query === dismissedQuery) return; // dismissed — never resurrect
		if (dismissedQuery !== null && query.length > dismissedQuery.length) {
			dismissedQuery = null; // longer query = fresh intent (unlock)
		}
		const seq = ++suggestSeq;
		try {
			const key = searchKey(query);
			// Trigger-char macro split: `!` runs macros (macro=1), `?` finds
			// ordinary prompts (macro=0) — each trigger sees only its shelf.
			const macro = triggerMode(query) === 'run' ? 1 : 0;
			const res = await fetch(
				`/api/prompts?q=${encodeURIComponent(key)}&limit=${SUGGEST_MAX_RESULTS}&mode=contains&macro=${macro}`
			);
			if (seq !== suggestSeq) return; // stale response — discarded
			if (!res.ok) {
				suggestRows = []; // silent degrade (BC-5)
				return;
			}
			const data = (await res.json()) as { results: SuggestedPrompt[] };
			// Post-await guard: text/dismissal may have changed during the fetch.
			const liveVal = el?.value ?? value;
			const liveQ = getTrigger(liveVal, el?.selectionStart ?? liveVal.length);
			if (liveQ !== query || liveQ === dismissedQuery) return;
			suggestRows = data.results ?? [];
			stripQuery = query;
			stripIndex = 0;
		} catch {
			if (seq !== suggestSeq) return;
			suggestRows = []; // silent degrade (BC-5)
		}
	}

	/** Auto-grow clamp: default 15 rows (user spec, 2026-08-23; OCI clamps
	 *  at ~12); operator-tunable via ~/.dsi/settings.yaml
	 *  `chat.input.maxRows` (ADR-0007 access-chip follow-up, 2026-08-25). */
	const MAX_ROWS = $derived(appConfig().chat.input.maxRows);

	let textareaEl: HTMLTextAreaElement | undefined = $state();
	/** Past the row clamp the box scrolls instead of growing. */
	let isOverflow = $state(false);

	/** Trigger active for the current text + caret — value-reactive for the
	 *  strip's visibility; the keydown guard reads the LIVE textarea (see
	 *  liveQuery) so a stale caret can never leak into interception.
	 *  (Declared after textareaEl — derived reads it.) */
	const triggerActive = $derived(
		getTrigger(value, textareaEl?.selectionStart ?? value.length) !== null
	);
	/** Rows the strip renders — trigger gone ⇒ no strip, stale rows or not. */
	const stripRows = $derived(triggerActive ? suggestRows : []);

	// ── Slash Menu state (ADR "The Slash Menu", 2026-08-30) ──
	/** The trimmed draft — the menu's query and its trigger share
	 *  parseCommand's normalization, so the stand-down is decided on the
	 *  same bytes the submit ladder will judge. */
	const slashDraft = $derived(value.trim());
	/** Parser stand-down (Resolved decision 6): the menu opens only on a
	 *  `/` draft parseCommand DECLINES — `/permission`/`/new` drafts keep
	 *  their byte-identical typed-gesture journeys, menu-free. */
	const slashTrigger = $derived(
		slashDraft.startsWith('/') && parseCommand(slashDraft) === null
	);
	/** Dismiss memo (the strip's dismissedQuery grammar): Esc or a pick
	 *  memo-closes the exact draft; a LONGER draft is fresh intent
	 *  (unlocked in handleInput); trigger gone clears the memo. */
	let slashDismissedQuery = $state<string | null>(null);
	$effect(() => {
		if (!slashTrigger) slashDismissedQuery = null;
	});
	/** The composer's THIRD floating surface — the strip's `?`/`!` and
	 *  the help card keep their triggers (higher-priority surfaces win;
	 *  both are mutually exclusive with the menu by trigger construction). */
	const slashOpen = $derived(
		slashTrigger &&
			!triggerActive &&
			!helpVisible &&
			!helpShape &&
			slashDraft !== slashDismissedQuery
	);
	/** Matched rows over ALL THREE sections — gestures first, then
	 *  commands, then skills (§1.1's layers A→B→C; the composite index
	 *  the menu highlights mirrors the submit ladder's own priority: a
	 *  name the parser owns wins before the host is consulted). The SAME
	 *  exported matcher the menu renders with — one source of truth, the
	 *  key guard can never drift from the visible rows. Loading/failed/
	 *  absent catalog ⇒ no rows ⇒ Enter falls through (loading rows
	 *  never intercept). */
	const slashRows = $derived.by(() => {
		if (!slashOpen || slashCatalog === null || slashCatalog.state !== 'ready') return [];
		return [
			...MENU_GESTURES.filter((r) => slashMenuMatches(r, slashDraft)).map((r) => ({
				kind: 'gesture' as const,
				name: r.name,
				seed: r.seed
			})),
			...slashCatalog.commands
				.filter((r) => slashMenuMatches(r, slashDraft))
				.map((r) => ({ kind: 'command' as const, name: r.name, hint: r.input?.hint !== undefined })),
			...slashCatalog.skills
				.filter((r) => slashMenuMatches(r, slashDraft))
				.map((r) => ({ kind: 'skill' as const, name: r.name }))
		];
	});
	/** Highlighted row over the matched set — arrows wrap, query change
	 *  resets to the top (the strip's reset-per-fetch rule, per keystroke). */
	let slashIndex = $state(0);
	$effect(() => {
		void slashDraft;
		slashIndex = 0;
	});
	// Catalog bridge (props-only contract): while the menu is open-shaped —
	// or a `?`-shaped draft asks about the host vocabulary — every query
	// move asks the panel to re-read directoryFor — a cached read is a
	// no-op map lookup; the first read (or a post-failure read) starts the
	// single-flight fetch. Never fires closed: a panel that never opens
	// the menu (and never asks a host `?`) wakes nothing (ADR §3.3, cold
	// sessions stay cold — an explicit `?` about a command IS the ask).
	$effect(() => {
		if (!slashOpen && !helpShape) return;
		void slashDraft; // re-query per keystroke, not only on the open edge
		onslashopen?.();
	});

	// Panel row mirror (Prompt Macro W2 2.2): report the live strip rows
	// upward whenever they change — the panel resolves accepted indices
	// into row text/id at accept time. Effect (not derived) on purpose:
	// the callback is an intent OUT, fired on change only.
	$effect(() => {
		const rows = stripRows;
		onrows?.(rows);
	});
	/** Strip mode for the live query (`!` → run, `?`/other → find) — read at
	 *  decision points from the LIVE textarea (accept + strip props), so a
	 *  stale caret can never run what the operator meant to insert. */
	const liveMode = () => triggerMode(liveQuery() ?? '?');

	// Config load: singleton GET /api/config — every mount may kick it, the
	// store dedupes to one fetch per page load. SSR-safe (onMount is a no-op
	// server-side); failures keep the default inside the store.
	onMount(() => {
		void loadAppConfig();
		// Swap-focus (2026-08-29): the textarea exists by onMount (bind:this
		// runs first); the mount lock is never held (sending/awaiting start
		// false), so the element accepts the caret.
		if (focusOnMount) {
			textareaEl?.focus();
			onfocused?.();
		}
		// Draft restore: the caret lands at the end of the restored text,
		// and a snapshot saved mid-typing takes the caret back — an HMR
		// strike or reload mid-sentence resumes where the keys stopped.
		// The swap-focus contract above stays the only onfocused fire.
		if (restoredDraft !== null) {
			queueMicrotask(() => {
				const el = textareaEl;
				// An unmount inside this microtask window nulls bind:this —
				// a gone composer owns no caret.
				if (el == null) return;
				el.selectionStart = value.length;
				el.selectionEnd = value.length;
				if (restoredDraft.focused) el.focus();
			});
		}
	});

	$effect(() => {
		void value; // re-run when text changes
		if (!textareaEl) return;
		// px() guards parseFloat: unresolved styles ("normal", "") yield NaN,
		// and a NaN maxHeight silently voids the height assignment (browsers
		// and happy-dom's CSSOM both reject "NaNpx" without error).
		const px = (v: string, fallback: number): number => {
			const n = parseFloat(v);
			return Number.isFinite(n) ? n : fallback;
		};
		const style = getComputedStyle(textareaEl);
		// Fallbacks match the classes: text-sm × leading-relaxed, py-2.
		const lineHeight = px(style.lineHeight, 22.75);
		const maxHeight = Math.round(MAX_ROWS * lineHeight + px(style.paddingTop, 8) + px(style.paddingBottom, 8));
		textareaEl.style.height = 'auto';
		const fits = Math.min(textareaEl.scrollHeight, maxHeight);
		textareaEl.style.height = `${fits}px`;
		isOverflow = textareaEl.scrollHeight > maxHeight;
	});

	/** Strip-only Esc (BC-9): close the strip and memo the exact query so
	 *  the 120 ms debounce never re-opens it; a longer query unlocks.
	 *  `refocus` false is the broadcast replay's hand — the box drives the
	 *  accept from the sidebar, and the panel must not steal the caret. */
	function closeStrip(refocus = true): void {
		const query = liveQuery();
		if (query) dismissedQuery = query;
		suggestRows = [];
		if (refocus) textareaEl?.focus();
	}

	/** Strip-only accept (Tab/Enter press 1, BC-2): replace the QUERY SPAN
	 *  [queryStart, queryEnd) with the row's full text — never the whole
	 *  value; trailing text and drafts survive. Caret lands at the end of
	 *  the inserted text; Enter press 2 then sends (the strip is closed).
	 *  RUN mode (Prompt Macro, D1): accepting never inserts — the row RUNS:
	 *  strip closes, the DRAFT CLEARS entirely (the query was the draft by
	 *  construction — the trigger is active only with the caret on a
	 *  single-line query), and onrunmacro fires with the row index.
	 *  `refocus` false is the broadcast replay's hand (see closeStrip). */
	function acceptRow(i: number, refocus = true): void {
		const el = textareaEl;
		if (!el) return;
		const query = getTrigger(el.value, el.selectionStart);
		if (!query) return;
		const row = suggestRows[i];
		if (!row) return;
		if (liveMode() === 'run' && onrunmacro !== undefined) {
			// Run-accept (ADR D1): prevent default happens in the keydown
			// guard; here the strip closes, the draft clears, the macro fires.
			value = '';
			suggestRows = [];
			dismissedQuery = null; // fresh intent — a re-typed query re-searches
			if (refocus) textareaEl?.focus();
			onrunmacro(i);
			return;
		}
		const queryStart = el.selectionStart - query.length;
		const queryEnd = Math.max(el.selectionEnd, el.selectionStart);
		value = value.slice(0, queryStart) + row.text + value.slice(queryEnd);
		suggestRows = [];
		queueMicrotask(() => {
			const caret = queryStart + row.text.length;
			el.selectionStart = caret;
			el.selectionEnd = caret;
			if (refocus) el.focus();
		});
	}

	/** Cycle the highlighted row — wraps both directions (arrows/Shift+Tab). */
	function cycleStrip(delta: number): void {
		const n = stripRows.length;
		if (n === 0) return;
		stripIndex = ((stripIndex + delta) % n + n) % n;
	}

	/** Cycle the menu's highlighted row over the MATCHED set (wraps). */
	function cycleSlash(delta: number): void {
		const n = slashRows.length;
		if (n === 0) return;
		slashIndex = ((slashIndex + delta) % n + n) % n;
	}

	/** Pick the highlighted row (Enter/Tab press 1, ADR §3.3) — the same
	 *  kind-aware branch both keys run, so Tab accepts exactly like Enter
	 *  (the strip's Tab-accept parity; Shift+Tab cycles back instead). */
	function pickHighlighted(): void {
		const row = slashRows[slashIndex];
		if (row === undefined) return;
		if (row.kind === 'gesture') {
			pickInsert(row.seed);
		} else if (row.kind === 'skill') {
			pickInsert(`/${row.name} `, () => onpickskill?.(row.name));
		} else if (row.hint) {
			pickInsert(`/${row.name} `, () => onpickcommandwithhint?.(row.name));
		} else {
			void pickExecute(row.name);
		}
	}

	// ── Slash Menu picks (kind-aware, ADR §3.3) ──
	/** The line a command pick executes: the draft VERBATIM when its first
	 *  token already names the row (case-insensitive — the rung matches
	 *  the same way), else the row's canonical name + the draft's raw
	 *  remainder (a `/comp` filter match still executes `/compact`).
	 *  Arguments are never re-parsed — the remainder rides untouched
	 *  (ADR §4.4; the host owns every grammar decision). */
	function slashLineFor(name: string): string {
		const at = slashDraft.search(/\s/);
		const token = at === -1 ? slashDraft : slashDraft.slice(0, at);
		if (token.slice(1).toLowerCase() === name.toLowerCase()) return slashDraft;
		return `/${name}${at === -1 ? '' : slashDraft.slice(at)}`;
	}

	/** Insert pick (gesture seed / hint command / skill): the seed lands
	 *  at draft start with the caret after it (`/name ` for name rows,
	 *  the gesture's own seed — `@session-` scaffolds the mention
	 *  grammar); the menu memo-closes on the new draft so the operator's
	 *  own Enter is press 2 (the two-press rule — the insert itself
	 *  never sends). Draft persistence is untouched: the assignment IS
	 *  the draft, the debounced save rides it. */
	function pickInsert(seed: string, fire?: (picked: string) => void, refocus = true): void {
		value = seed;
		slashDismissedQuery = slashDraft;
		slashIndex = 0;
		if (refocus)
			queueMicrotask(() => {
				const el = textareaEl;
				// `== null` (not `=== undefined`): the microtask can fire after an
				// unmount zeroed bind:this (the restore-draft microtask's guard).
				if (el == null) return;
				el.selectionStart = value.length;
				el.selectionEnd = value.length;
				el.focus();
			});
		fire?.(seed);
	}

	/** Execute pick (hint-less command): the draft clears only on an
	 *  ADMITTED execution (BC-A3 — the panel's boolean); a miss or error
	 *  keeps the draft and memo-closes the menu — the honest banner note
	 *  is the receipt, the kept draft is the operator's to fix or send.
	 *  `refocus` false is the broadcast replay's hand (see pickInsert). */
	async function pickExecute(name: string, refocus = true): Promise<void> {
		if (onpickcommand === undefined) return;
		const line = slashLineFor(name);
		slashIndex = 0;
		const cleared = await onpickcommand(line);
		if (cleared !== false) {
			value = '';
			slashDismissedQuery = null;
		} else {
			slashDismissedQuery = slashDraft;
		}
		if (refocus) textareaEl?.focus();
	}

	/** Strip-row rename (⋯ menu Save): PATCH the subset that changed, then
	 *  refetch rows + refocus (409 keeps the old fields — just re-fetch). */
	async function renameRow(
		row: SuggestedPrompt,
		fields: { uses: string; label: string; text: string }
	): Promise<void> {
		const body: Record<string, unknown> = {};
		const uses = parseInt(fields.uses, 10);
		if (!Number.isNaN(uses) && uses !== row.use_count) body.use_count = uses;
		const cleanLabel = fields.label.trim().slice(0, 60);
		if ((cleanLabel || null) !== (row.label ?? null)) body.label = cleanLabel || null;
		const cleanText = fields.text.trim();
		if (cleanText && cleanText !== row.text) body.text = cleanText;
		if (Object.keys(body).length > 0) {
			try {
				const res = await fetch(`/api/prompts/${row.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				});
				if (!res.ok && res.status !== 409) return;
			} catch {
				/* offline: keep UI as-is (silent degrade, BC-5) */
			}
		}
		await fetchSuggestions();
		textareaEl?.focus();
	}

	/** Strip-row delete (⋯ menu): fire-and-forget DELETE, then refetch. */
	async function deleteRow(row: SuggestedPrompt): Promise<void> {
		try {
			await fetch(`/api/prompts/${row.id}`, { method: 'DELETE' });
			await fetchSuggestions();
		} catch {
			/* offline: keep UI as-is (silent degrade, BC-5) */
		}
	}

	// Streaming/submit lock clears the strip (PRD edge: the strip clears
	// when the textarea locks; the query dies with the cleared draft).
	$effect(() => {
		if (!locked) return;
		suggestRows = [];
		stripIndex = 0;
		if (suggestTimer) clearTimeout(suggestTimer);
		suggestSeq++; // invalidate any in-flight fetch
	});

	async function submit(): Promise<boolean> {
		if (isStreaming || locked) return false;
		if (helpTopic !== null || helpShape) return false; // a `?` help line is a question, never a send
		// A run-shaped draft is macro traffic, never a send (Prompt Sync
		// amendment 2026-09-04): the strip's run accept is a `!` line's
		// only executor — the line itself must not ride the wire as a
		// prompt, broadcast or typed. Find-shape (`?`) keeps its pinned
		// fall-through: an unmatched finder question ships as chat.
		const draftShape = getTrigger(value, value.length);
		if (draftShape !== null && triggerMode(draftShape) === 'run') return false;
		const text = value.trim();
		if (text.length === 0 && drafts.length === 0) return false;
		const imageIds = drafts.map((draft) => draft.id);
		value = '';
		awaiting = true;
		try {
			// The ONLY base64 moment (BC-A2): drafts serialize at submit and
			// ride the widened callback; the panel POSTs them (task 2.4).
			const images = imageIds.length > 0 ? ((await attachmentMgr?.serialize(imageIds)) ?? []) : [];
			const admitted = await onsubmit(text, images);
			// Admitted send OR completed command dispatch (the panel
			// intercepts commands and returns true — BC-A7 clears them
			// too). An explicit false keeps the attachments (BC-A3) AND
			// restores the line: a rejected send or a command-rung miss
			// leaves the operator's text in the composer — never in the
			// void behind an honest banner (Slash Menu ADR §4.3/§5).
			if (admitted !== false) {
				attachmentMgr?.clear();
			} else if (value === '') {
				value = text;
			}
			return admitted !== false;
		} finally {
			awaiting = false;
		}
	}

	/** The Prompt Sync member's submit (ADR D5): the SAME ladder, the
	 *  boolean the broadcast pass counts — a refusal here is what keeps
	 *  a panel's mirrored draft and lands it in `kept`. */
	function submitForSync(): Promise<boolean> {
		return submit();
	}

	// The broadcast strip hand (amended 2026-09-04): the box's navigation
	// fans out through the store, and the grammar stays THIS panel's own —
	// cycle moves the highlight, accept runs the same acceptRow (the pick
	// path, run mode included) minus the focus steal, dismiss memoizes the
	// query exactly like a local Esc (BC-9).
	function syncStripState(): SyncStripView | null {
		return stripRows.length > 0
			? { rows: stripRows, index: stripIndex, query: stripQuery, mode: liveMode() }
			: null;
	}
	function syncCycleStrip(delta: number): void {
		cycleStrip(delta);
	}
	function syncAcceptStrip(): void {
		acceptRow(stripIndex, false);
	}
	function syncDismissStrip(): void {
		closeStrip(false);
	}

	// The broadcast slash hand (amended 2026-09-04 — the third surface
	// joins the box): the same replay shape as the strip's. The view is
	// THIS member's own menu (its catalog, its matched composite, its
	// highlight); the box renders it verbatim and fans intents back.
	function syncSlashState(): SyncSlashView | null {
		return slashOpen
			? {
					gestures: MENU_GESTURES,
					commands: slashCatalog?.commands ?? [],
					skills: slashCatalog?.skills ?? [],
					state: slashCatalog?.state ?? 'idle',
					query: slashDraft,
					index: slashIndex
				}
			: null;
	}
	function syncCycleSlash(delta: number): void {
		cycleSlash(delta);
	}
	function syncDismissSlash(): void {
		slashDismissedQuery = slashDraft; // the menu's own Esc: memoize the exact draft
	}
	function syncAcceptSlashInsert(text: string): void {
		pickInsert(text, undefined, false);
	}
	function syncAcceptSlashExecute(name: string): void | Promise<void> {
		return pickExecute(name, false);
	}

	// Membership (ADR D1/D2): the composer joins the sync store keyed by
	// its session; the disposer rides the effect cleanup — unmount (panel
	// close, /new remount) unregisters.
	$effect(() => {
		if (sessionId === undefined) return;
		return registerSyncMember(sessionId, {
			getText: () => value,
			setText: (text: string) => {
				value = text;
			},
			submit: submitForSync,
			syncStripState,
			syncCycleStrip,
			syncAcceptStrip,
			syncDismissStrip,
			syncSlashState,
			syncCycleSlash,
			syncDismissSlash,
			syncAcceptSlashInsert,
			syncAcceptSlashExecute
		});
	});

	// Mirror (ADR D3/D4; D4 as amended 2026-09-04): once the broadcast has
	// claimed this panel — the box held text at check time, or a non-empty
	// push landed while checked — the draft mirrors the shared text
	// verbatim, '' included, so clearing the box clears the panel. Before
	// the claim the store's verdict is `undefined` (a check never wipes),
	// and the write is skipped when the verdict repeats: an unrelated
	// membership transition re-runs this effect and must not echo the box
	// over a panel-local edit (D3).
	let lastMirrored: string | undefined;
	$effect(() => {
		if (sessionId === undefined) return;
		const text = mirrorTextFor(sessionId);
		if (text === undefined) {
			lastMirrored = undefined; // the claim ended — a new claim overwrites
			return;
		}
		if (text === lastMirrored) return;
		// Land the DOM text BEFORE the state write: the trigger derived
		// snapshots the untracked textarea caret at its eager re-evaluation
		// (selectionStart is not reactive state), and the bind lands the new
		// value only later in the flush — writing state first would cache a
		// trigger verdict computed against the stale caret. The element's
		// value setter rides the caret to the end, the mirrored caret.
		const el = textareaEl;
		if (el !== undefined) el.value = text;
		value = text;
		lastMirrored = text;
		// A mirrored draft wakes the panel's own surfaces like a typed one:
		// the help card and slash menu are value-derived and wake themselves,
		// but the strip's rows ride a fetch that only DOM input events used
		// to schedule. Trigger-shaped mirrored text schedules it too — the
		// 120 ms debounce also lands the bind's DOM value ahead of
		// fetchSuggestions' live read. A locked composer stays strip-free
		// (the lock clears the strip).
		if (!locked && getTrigger(text, text.length) !== null) scheduleSuggest();
	});

	/** Paste forwarding: image clipboard items become drafts; text stays text. */
	function handlePaste(event: ClipboardEvent): void {
		attachmentMgr?.handlePaste(event);
	}

	/** Draft input: the strip's debounce PLUS the slash-menu dismiss
	 *  unlock (the strip's rule — a longer draft is fresh intent, so a
	 *  memo-closed menu re-arms as the operator keeps typing). The draft
	 *  is read from the live element: bind:value ordering vs this handler
	 *  is not relied on (the file's live-read convention). */
	function handleInput(): void {
		const draft = (textareaEl?.value ?? value).trim();
		if (slashDismissedQuery !== null && draft.length > slashDismissedQuery.length) {
			slashDismissedQuery = null;
		}
		scheduleSuggest();
	}

	/** Blur = the operator looked away: flush immediately with
	 *  focused=false so a stale focused=true snapshot can never make an
	 *  unrelated composer steal the caret on the next restore. */
	function handleBlur(): void {
		textareaFocused = false;
		if (sessionId === undefined) return;
		if (draftTimer !== null) clearTimeout(draftTimer);
		draftTimer = null;
		if (value.length > 0) saveDraft(sessionId, value, false);
		else clearDraft(sessionId);
	}

	async function onkeydown(event: KeyboardEvent): Promise<void> {
		// Suggest keys first (BC-6: guard is EXACTLY triggerActive &&
		// rows.length > 0 — ghost absent by construction; IME passes through,
		// BC-8). Enter press 1 accepts, press 2 sends (BC-2).
		const intercept =
			!isComposing &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			liveQuery() !== null &&
			stripRows.length > 0;
		if (intercept) {
			if (event.key === 'Tab' && event.shiftKey) {
				if (stripRows.length > 1) {
					event.preventDefault();
					cycleStrip(-1);
				}
				return;
			}
			if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
				event.preventDefault();
				acceptRow(stripIndex);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				closeStrip();
				return;
			}
			if (event.key === 'ArrowDown' && stripRows.length > 1) {
				event.preventDefault();
				cycleStrip(1);
				return;
			}
			if (event.key === 'ArrowUp' && stripRows.length > 1) {
				event.preventDefault();
				cycleStrip(-1);
				return;
			}
		}
		// A run-shaped draft with no live rows is a macro command standing
		// by (BC-9 memoized, or the fetch has not landed): Enter re-arms
		// the strip instead of shipping the line — the help card's own
		// dismissed-reopen rule, extended to the fetch-driven surface.
		// A zero-match query re-arms to nothing (the strip stays dark,
		// the silent-degrade posture, BC-5) and the draft stays for
		// editing. Find-shape (`?`) keeps its pinned press-through: an
		// unmatched finder question submits as chat.
		if (
			!isComposing &&
			liveQuery() !== null &&
			triggerMode(liveQuery() ?? '?') === 'run' &&
			stripRows.length === 0
		) {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				dismissedQuery = null;
				void fetchSuggestions();
				return;
			}
		}
		// Command help keys (command-help, 2026-08-30): the card is
		// information-only — Esc hides it while the text keeps matching,
		// and Enter never sends a `?` help line: with the card up the press
		// is already answered; dismissed, it re-opens the card instead.
		// The shape owns its keys even while the catalog is still loading
		// (a `?` line must never ride the wire as bogus arguments).
		if (!isComposing && (helpTopic !== null || helpShape)) {
			if (event.key === 'Escape') {
				event.preventDefault();
				helpDismissed = true;
				return;
			}
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				helpDismissed = false;
				return;
			}
		}
		// Slash Menu keys (ADR "The Slash Menu", 2026-08-30): ROW-GATED
		// interception — the strip's shipped guard shape (matched rows only).
		// Tab/Enter accept the highlighted row, arrows cycle, Esc dismisses.
		// With zero matching rows (and while loading/failed) Enter falls
		// through to submit and the menu closes with the cleared draft —
		// unknown /nope ships as chat exactly as today; IME composes pass
		// through untouched (the strip's guard, verbatim).
		if (!isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && slashOpen) {
			if (event.key === 'Escape') {
				event.preventDefault();
				slashDismissedQuery = slashDraft;
				return;
			}
			if (slashRows.length > 0) {
				if (event.key === 'Tab' && event.shiftKey) {
					// The strip's Shift+Tab: cycle back; with one row the press
					// is swallowed (no focus escape from an open menu).
					event.preventDefault();
					if (slashRows.length > 1) cycleSlash(-1);
					return;
				}
				if (event.key === 'ArrowDown' && slashRows.length > 1) {
					event.preventDefault();
					cycleSlash(1);
					return;
				}
				if (event.key === 'ArrowUp' && slashRows.length > 1) {
					event.preventDefault();
					cycleSlash(-1);
					return;
				}
				// Tab and Enter are the SAME accept (the strip's rule): the
				// kind-aware pick — gesture/hint/skill insert the seed (the
				// operator's own Enter is press 2), a hint-less command
				// executes. Tab never moves focus while rows intercept it.
				if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
					event.preventDefault();
					pickHighlighted();
					return;
				}
			}
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			await submit();
		}
	}
</script>

<div class="flex flex-col gap-1.5" data-testid="prompt-input">
	<!-- OCI AttachmentChips placement: the pending-file row sits ABOVE the
	     input row — attachments are about the message being composed. -->
	<AttachmentChips {drafts} onremove={(id) => attachmentMgr?.removeAttachment(id)} />

	<div class="flex items-end gap-2">
		<!-- Prompt Sync checkmark column (ADR D8, 2026-09-04): the left
		     flank mirrors the right — the membership toggle stacked ABOVE
		     the paperclip button, bottom-aligned by the row's items-end.
		     Unchecked is the AttachmentManager ghost grammar; checked is
		     the app's yellowgreen selected state (the .on scoped rule). -->
		<div class="flex shrink-0 flex-col items-center gap-1">
			{#if sessionId !== undefined}
				<button
					type="button"
					data-testid="prompt-sync-check"
					aria-pressed={syncChecked}
					title={t(m.syncComposer)}
					class="prompt-sync-check flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
					class:on={syncChecked}
					disabled={lens}
					onclick={() => setSyncChecked(sessionId, !syncChecked)}
				>
					{#if syncChecked}
						<SquareCheck size={16} />
					{:else}
						<Square size={16} />
					{/if}
				</button>
			{/if}
			<AttachmentManager bind:this={attachmentMgr} bind:drafts disabled={locked} limits={imageLimits ?? DEFAULT_IMAGE_LIMITS} />
		</div>
		<!-- OCI textarea-wrap pattern: the relative wrapper anchors the
		     streaming dots overlay (right edge, vertically centered on the
		     Send/Cancel button — the row is items-end, so the anchor holds
		     while the textarea auto-grows). -->
		<div class="relative flex-1">
			<!-- Command help card (command-help, 2026-08-30): floating above
			     the textarea wrapper, same geometry as the strip — shows the
			     draft's usage while it asks `?` (a DSI gesture from the
			     COMMAND_HELP copy, or a host command/skill from the cached
			     catalog row's own wire copy). Mutually exclusive with the
			     strip by construction (`?`/`!` lead vs a `/`- or
			     `@token ?`-shaped draft). -->
			{#if helpVisible && helpView !== null}
				<CommandHelpCard view={helpView} />
			{/if}
			<!-- Slash Menu (ADR "The Slash Menu", 2026-08-30): the composer's
			     THIRD floating surface — same geometry as strip/help card
			     (absolute above the wrapper, never joins layout); mutually
			     exclusive with both by trigger construction. Presentational
			     rows only: catalog state rides props from the panel, the
			     keyboard lifecycle is the row-gated onkeydown guard above. -->
			{#if slashOpen}
				<SlashMenu
					gestures={MENU_GESTURES}
					commands={slashCatalog?.commands ?? []}
					skills={slashCatalog?.skills ?? []}
					state={slashCatalog?.state ?? 'idle'}
					query={slashDraft}
					activeIndex={slashIndex}
					onpickgesture={(seed) => pickInsert(seed)}
					onpickcommand={(name) => void pickExecute(name)}
					onpickcommandwithhint={(name) =>
						pickInsert(`/${name} `, () => onpickcommandwithhint?.(name))}
					onpickskill={(name) => pickInsert(`/${name} `, () => onpickskill?.(name))}
				/>
			{/if}
			<!-- Suggest Strip (ADR "The Suggest Strip", W2): floating above the
			     textarea wrapper — never joins layout (BC-1). Renders nothing
			     while no rows (component-level {#if}). -->
			<SuggestStrip
				rows={stripRows}
				activeIndex={stripIndex}
				query={stripQuery}
				mode={liveMode()}
				onpick={acceptRow}
				// ⏯ Step starts the run too (held) — same composer hygiene as
				// run-accept: strip closes, draft clears, focus returns.
				onstep={
					onstep === undefined
						? undefined
						: (i: number) => {
								value = '';
								suggestRows = [];
								dismissedQuery = null;
								textareaEl?.focus();
								onstep(i);
							}
				}
				onrename={renameRow}
				ondelete={deleteRow}
				onmanage={() => {
					managerOpen = true;
					textareaEl?.focus();
				}}
				onclose={() => textareaEl?.focus()}
			/>
			<!-- PromptInputText — the composer textarea. display:block keeps
			     this wrapper collapsed onto the box (2026-08-24 alignment
			     fix — the geometry note lives in the component). The element
			     and the draft bind back: focus, autosize, selection and the
			     draft flushes stay the owner's. -->
			<PromptInputText
				bind:el={textareaEl}
				bind:value
				maxRows={MAX_ROWS}
				{isStreaming}
				{locked}
				{awaiting}
				{isOverflow}
				onkeydown={onkeydown}
				onpaste={handlePaste}
				oninput={handleInput}
				onfocus={() => (textareaFocused = true)}
				onblur={handleBlur}
				oncompositionstart={() => (isComposing = true)}
				oncompositionend={() => {
					isComposing = false;
					scheduleSuggest(); // the composed text is final — search it
				}}
			/>
			{#if isStreaming || awaiting}
				<StreamingIndicator title={isStreaming ? 'Turn in flight…' : 'Sending…'} />
			{/if}
		</div>

		<!-- Right-flank column (2026-09): the stick toggle moved to the
		     panel's floating mount; this column keeps the Send/Cancel face
		     bottom-aligned (items-end). -->
		<div class="flex shrink-0 flex-col items-center justify-end gap-1">
		{#if isStreaming}
			<!-- OCI cancel-btn parity: 2rem red square, filled Square icon,
			     hover darkens + scales 1.05, disabled at 0.3 opacity. -->
			<button
				type="button"
				onclick={() => void oncancel()}
				data-testid="cancel-button"
				class="cancel-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-500 text-white transition-[background-color,transform] hover:bg-red-600 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30"
				disabled={locked}
				title={t(m.stopStreaming)}
				aria-label={t(m.stopStreaming)}
			>
				<Square size={14} fill="currentColor" />
			</button>
		{:else}
			<!-- OCI send-btn parity: 2rem blue square, ArrowUp icon, hover
			     darkens; disabled at 0.3 opacity (empty/locked states). -->
			<button
				type="button"
				onclick={() => void submit()}
				disabled={disabled}
				data-testid="send-button"
				class="send-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-30"
				title={t(m.sendMessage)}
				aria-label={t(m.sendMessage)}
			>
				<ArrowUp size={18} />
			</button>
		{/if}
		</div>
	</div>

	{#if sessionId !== undefined || contextTokens !== undefined || (permission !== null && permission !== undefined && onpermission !== undefined)}
		<!-- OCI ChatInput info-row pattern: token + access (left) · model
		     (center) · context (right). justify-between keeps the selector
		     truly centered between flanks of unequal width. -->
		<div class="flex items-center justify-between gap-2 px-1" data-testid="prompt-info-row">
			<span class="flex min-w-0 items-center gap-2">
				<TokenCounter text={value} />
				{#if permission !== null && permission !== undefined && onpermission !== undefined}
					<!-- DSH parity (2026-08-28 bug fix): a RUNNING turn never locks
					     the chip — the pick rides the host-side /permission command
					     wire and never touches the model or the turn (DSH's
					     PermissionRow gates only its own load/save lifecycle). Only
					     the brief submit window (`locked`) keeps the footer's
					     uniform lock. -->
					<AccessModeChip {permission} disabled={locked} onpick={onpermission} />
				{/if}
			</span>
			{#if sessionId !== undefined}
				<ModelSelector {sessionId} menuUp disabled={locked} />
			{/if}
			<ContextConsumption used={contextTokens} limit={totalContextLimit} />
		</div>
	{/if}

	{#if managerOpen}
		<!-- Prompts Manager host (Wave 3, BC-7): the host div portals to
		     document.body — the modal's position:fixed escapes the panel
		     floor's CSS zoom. The strip refreshes nothing eagerly on change;
		     it refetches on the next trigger. -->
		<div bind:this={mgrPortal}>
			<PromptsManagerDialog
				onclose={() => {
					managerOpen = false;
				}}
				onchanged={() => {
					/* strip refetches on next trigger — nothing eager */
				}}
			/>
		</div>
	{/if}
</div>

<style>
	/* Control-owned icon color (app.css icon standard exception): the
	   send/cancel surfaces are saturated (blue/red) with white glyphs —
	   the global purple icon default must not paint the icon into its
	   own button surface. */
	.cancel-btn :global(svg),
	.send-btn :global(svg) {
		color: inherit;
	}

	/* Prompt Sync checkmark (ADR D8): unchecked keeps the ghost grammar
	   (the utility classes); checked is the segmented-toggle's selected
	   state — yellowgreen glyph, unlayered rule beats the utility color. */
	.prompt-sync-check :global(svg) {
		color: inherit;
	}
	.prompt-sync-check.on {
		color: yellowgreen;
	}
	.prompt-sync-check.on:hover {
		color: color-mix(in srgb, yellowgreen 70%, black);
		background-color: color-mix(in srgb, yellowgreen 12%, #fff);
	}
</style>
