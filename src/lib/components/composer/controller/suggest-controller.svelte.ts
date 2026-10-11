import { getTrigger, searchKey, triggerMode, type SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

/** Live element reader — the file's live-caret convention: the caret is
 *  NEVER cached as reactive state; decision points read the DOM live. */
export interface ElementSource {
	getElement(): HTMLTextAreaElement | undefined;
	getValue(): string;
	setValue(v: string): void;
}

/** Shell-injected state (ADR-0020 D2 — precedence stays the shell's). */
export interface StripGates {
	/** The value-reactive trigger read (submit ladder + slash gate share it). */
	active(): boolean;
	/** Submit/lock window — the strip clears when the textarea locks. */
	locked(): boolean;
}

export interface StripCallbacks {
	onrunmacro?: (index: number) => void;
	onrows?: (rows: SuggestedPrompt[]) => void;
	/** The pre-move acceptRow/accept re-focus (direct element focus). */
	focus(): void;
}

const SUGGEST_DEBOUNCE_MS = 120;
/** API search-mode limit clamp is 10 (W1 GET contract). */
const SUGGEST_MAX_RESULTS = 10;

/**
 * StripController — the suggest strip's surface machine (ADR-0020 D1,
 * moved verbatim from Composer.svelte's "The Suggest Strip" W2 block).
 * The only controller that fetches: 120 ms debounce against
 * GET /api/prompts?mode=contains with the trigger-char macro split,
 * the out-of-order seq guard, the dismissed-query memo (BC-9), silent
 * degrade (BC-5), the query-span accept splice (BC-2), run-mode
 * find-and-RUN accepts (Prompt Macro D1), and the rename/delete RPCs
 * with 409 tolerance. The lock-clears-strip and onrows-mirror effects
 * move with it, driven by shell-injected gates/callbacks.
 *
 * Per-mount by construction (ADR-0020 D1). The shell keeps the LADDER
 * (D2): handles()/onKey() answer; IME, modifier gates, rung order and
 * submit stay in Composer.svelte.
 */
export class StripController {
	#src: ElementSource;
	#gates: StripGates;
	#cb: StripCallbacks;

	/** Rows fetched for the live query — strip-only (no ghost, ADR §6). */
	#rows = $state<SuggestedPrompt[]>([]);
	/** Highlighted row (arrows wrap, Tab/Enter accept). */
	index = $state(0);
	/** Live trigger query the rows belong to — fragment highlighting (F4). */
	query = $state('');
	/** 120 ms debounce timer (non-reactive — scheduling detail). */
	#timer: ReturnType<typeof setTimeout> | null = null;
	/** Out-of-order response guard: only the newest fetch may write rows. */
	#seq = 0;
	/** Query the user explicitly rejected (Esc): the debounced refetch
	 *  never resurrects it; typing one more character unlocks it. */
	#dismissedQuery: string | null = null;

	/** The per-mount effect root's stop fn — destroy() at teardown so the
	 *  controller's effects never outlive their component. */
	#stop: () => void;

	constructor(src: ElementSource, gates: StripGates, callbacks: StripCallbacks) {
		this.#src = src;
		this.#gates = gates;
		this.#cb = callbacks;
		this.#stop = $effect.root(() => {
			// Streaming/submit lock clears the strip (PRD edge): the query
			// dies with the cleared draft.
			$effect(() => {
				if (!this.#gates.locked()) return;
				this.#rows = [];
				this.index = 0;
				if (this.#timer) clearTimeout(this.#timer);
				this.#seq++; // invalidate any in-flight fetch
			});
			// Panel row mirror (Prompt Macro W2 2.2): report the live rows
			// upward on change — effect (not derived) on purpose: the callback
			// is an intent OUT, fired on change only.
			$effect(() => {
				const rows = this.rows;
				this.#cb.onrows?.(rows);
			});
		});
	}

	/** Teardown (the shell calls it at unmount): stops the root's effects
	 *  — a destroyed composer's deriveds must never be read again. */
	destroy(): void {
		this.#stop();
	}

	/** Live query from the DOM — always read at decision points: caret
	 *  position is not reactive state. */
	liveQuery(): string | null {
		const el = this.#src.getElement();
		return getTrigger(el?.value ?? this.#src.getValue(), el?.selectionStart ?? this.#src.getValue().length);
	}

	/** Value-reactive trigger — the strip's visibility gate (stale caret
	 *  can never leak into INTERCEPTION; the keydown guard reads live). */
	get active() {
		return this.#gates.active();
	}

	/** Rows the strip renders — trigger gone ⇒ no strip, stale rows or not. */
	get rows(): SuggestedPrompt[] {
		return this.active ? this.#rows : [];
	}

	/** Strip mode for the live query (`!` → run, `?`/other → find). */
	liveMode(): 'run' | 'find' {
		return triggerMode(this.liveQuery() ?? '?');
	}

	/** The keydown rung's gate (BC-6, verbatim shape): trigger + live rows. */
	handles(): boolean {
		return this.liveQuery() !== null && this.rows.length > 0;
	}

	/** A run-shaped draft with no live rows: a macro command standing by —
	 *  Enter re-arms the strip instead of shipping the line (BC-9 memoized
	 *  or the fetch has not landed). Returns false when not in this shape. */
	runRearmNeeded(): boolean {
		return (
			this.liveQuery() !== null &&
			triggerMode(this.liveQuery() ?? '?') === 'run' &&
			this.rows.length === 0
		);
	}

	/** Debounced search (BC-3: DSI-local GET /api/prompts). */
	schedule(): void {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.#fetch(), SUGGEST_DEBOUNCE_MS);
	}

	async #fetch(): Promise<void> {
		const el = this.#src.getElement();
		// ALWAYS read live state — a stale timer may fire after user edits.
		const caret = el?.selectionStart ?? this.#src.getValue().length;
		const current = el?.value ?? this.#src.getValue();
		const query = getTrigger(current, caret);
		if (!query) {
			this.#rows = [];
			return;
		}
		if (query === this.#dismissedQuery) return; // dismissed — never resurrect
		if (this.#dismissedQuery !== null && query.length > this.#dismissedQuery.length) {
			this.#dismissedQuery = null; // longer query = fresh intent (unlock)
		}
		const seq = ++this.#seq;
		try {
			const key = searchKey(query);
			// Trigger-char macro split: `!` runs macros (macro=1), `?` finds
			// ordinary prompts (macro=0) — each trigger sees only its shelf.
			const macro = triggerMode(query) === 'run' ? 1 : 0;
			const res = await fetch(
				`/api/prompts?q=${encodeURIComponent(key)}&limit=${SUGGEST_MAX_RESULTS}&mode=contains&macro=${macro}`
			);
			if (seq !== this.#seq) return; // stale response — discarded
			if (!res.ok) {
				this.#rows = []; // silent degrade (BC-5)
				return;
			}
			const data = (await res.json()) as { results: SuggestedPrompt[] };
			// Post-await guard: text/dismissal may have changed during the fetch.
			const liveVal = el?.value ?? this.#src.getValue();
			const liveQ = getTrigger(liveVal, el?.selectionStart ?? liveVal.length);
			if (liveQ !== query || liveQ === this.#dismissedQuery) return;
			this.#rows = data.results ?? [];
			this.query = query;
			this.index = 0;
		} catch {
			if (seq !== this.#seq) return;
			this.#rows = []; // silent degrade (BC-5)
		}
	}

	/** Strip-only Esc (BC-9): close and memo the exact query so the debounce
	 *  never re-opens it. `refocus` false is the broadcast replay's hand. */
	close(refocus = true): void {
		const query = this.liveQuery();
		if (query) this.#dismissedQuery = query;
		this.#rows = [];
		if (refocus) this.#cb.focus();
	}

	/** Strip-only accept (Tab/Enter press 1, BC-2): replace the QUERY SPAN,
	 *  never the whole value. RUN mode (Prompt Macro D1): the row RUNS —
	 *  strip closes, the DRAFT CLEARS entirely, onrunmacro fires. */
	accept(i: number, refocus = true): void {
		const el = this.#src.getElement();
		if (!el) return;
		const query = getTrigger(el.value, el.selectionStart);
		if (!query) return;
		const row = this.#rows[i];
		if (!row) return;
		if (this.liveMode() === 'run' && this.#cb.onrunmacro !== undefined) {
			// Run-accept (ADR D1): the strip closes, the draft clears, the
			// macro fires.
			this.#src.setValue('');
			this.#rows = [];
			this.#dismissedQuery = null; // fresh intent — a re-typed query re-searches
			if (refocus) this.#cb.focus();
			this.#cb.onrunmacro(i);
			return;
		}
		const queryStart = el.selectionStart - query.length;
		const queryEnd = Math.max(el.selectionEnd, el.selectionStart);
		this.#src.setValue(this.#src.getValue().slice(0, queryStart) + row.text + this.#src.getValue().slice(queryEnd));
		this.#rows = [];
		queueMicrotask(() => {
			const caret = queryStart + row.text.length;
			el.selectionStart = caret;
			el.selectionEnd = caret;
			if (refocus) el.focus();
		});
	}

	/** Run-shape re-arm (BC-9): forget the dismissal, refetch now. */
	rearmRun(): void {
		this.#dismissedQuery = null;
		void this.#fetch();
	}

	/** ⏯ Step's strip hand: rows gone, dismissal forgotten — the run
	 *  starts held with the same hygiene as run-accept (draft clearing
	 *  and focus stay the shell's). */
	forgetRows(): void {
		this.#rows = [];
		this.#dismissedQuery = null;
	}

	/** Cycle the highlighted row — wraps both directions (arrows/Shift+Tab). */
	cycle(delta: number): void {
		const n = this.rows.length;
		if (n === 0) return;
		this.index = (((this.index + delta) % n) + n) % n;
	}

	/** Strip-row rename (⋯ menu Save): PATCH the changed subset, then
	 *  refetch + refocus (409 keeps the old fields — just re-fetch). */
	async rename(row: SuggestedPrompt, fields: { uses: string; label: string; text: string }): Promise<void> {
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
		await this.#fetch();
		this.#cb.focus();
	}

	/** Strip-row delete (⋯ menu): fire-and-forget DELETE, then refetch. */
	async remove(row: SuggestedPrompt): Promise<void> {
		try {
			await fetch(`/api/prompts/${row.id}`, { method: 'DELETE' });
			await this.#fetch();
		} catch {
			/* offline: keep UI as-is (silent degrade, BC-5) */
		}
	}
}
