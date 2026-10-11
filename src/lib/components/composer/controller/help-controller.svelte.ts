import {
	commandHelpTopic,
	gestureHelpCardView,
	helpQuery,
	hostHelpCardView
} from '$lib/services/chat/command-help';
import type { SlashDirectory } from '$lib/services/chat/slash-directory.svelte';

/**
 * HelpController — the command-help card's surface machine (ADR-0020 D1,
 * extracted verbatim from Composer.svelte's 2026-08-30 block).
 *
 * Carries, unchanged:
 *   - topic help: a known DSI gesture with \'?\' as its entire first argument
 *     (whole-line shape, never caret-positioned);
 *   - host help: a declined /token ? draft resolved against the SAME cached
 *     catalog the slash menu reads — DSI invents no copy;
 *   - the Esc memo: hide while the text keeps matching, any edit (or the
 *     shape vanishing) re-arms;
 *   - visibility and the view (gesture copy, else the host row\'s own).
 *
 * Per-mount by construction (ADR-0020 D1): the composer constructs one
 * instance at init; mount lifetime is the state lifetime.
 *
 * The shell keeps the LADDER (ADR-0020 D2): this controller only answers
 * handles()/onKey() — the IME gate and rung ORDER stay in Composer.svelte.
 */
export class HelpController {
	/** Draft accessor — reads the composer\'s reactive value at each derived
	 *  re-evaluation; the composer owns the draft (state homes, ADR-0020 §6.2). */
	#draft: { getValue(): string };
	/** The panel\'s cached catalog bridge (props down, ADR "The Slash Menu") —
	 *  read live so host help appears only when the catalog is ready. */
	#getCatalog: () => SlashDirectory | null;

	/** Esc memo: hide while the text keeps matching; any edit re-arms. */
	#dismissed = $state(false);

	constructor(draft: { getValue(): string }, getCatalog: () => SlashDirectory | null) {
		this.#draft = draft;
		this.#getCatalog = getCatalog;
		// The memo\'s auto-reset, verbatim from the pre-move inline effect
		// (Composer.svelte L308-L310): a draft that no longer resolves any
		// help re-arms the card. $effect.root keeps the controller legal
		// BOTH inside component init (the composer\'s mount) and outside it
		// (direct unit tests) — the root\'s lifetime is this instance\'s.
		$effect.root(() => {
			$effect(() => {
				if (this.topic === null && this.host === null) this.#dismissed = false;
			});
		});
	}

	/** Live help topic for the draft — non-null while the text is a known
	 *  DSI gesture with \'?\' as its entire first argument (/new ? …). */
	get topic() {
		return commandHelpTopic(this.#draft.getValue());
	}

	/** Host-vocabulary help: null while the catalog is idle/loading/failed
	 *  or the token is unknown — the card\'s absence is the honest answer. */
	get host() {
		const catalog = this.#getCatalog();
		return catalog !== null && catalog.state === 'ready'
			? hostHelpCardView(this.#draft.getValue(), catalog.commands, catalog.skills)
			: null;
	}

	/** Any \'?\'-shaped draft (DSI gesture or host row) — the menu stands
	 *  down while a question is on the line, resolved or not. */
	get shape() {
		return this.topic !== null || helpQuery(this.#draft.getValue()) !== null;
	}

	/** The card\'s view — the gesture copy, else the host row\'s own. */
	get view() {
		const topic = this.topic;
		const host = this.host;
		return topic !== null ? gestureHelpCardView(topic) : host !== null ? host : null;
	}

	/** Resolved card present (topic or host row) and not Esc-memoized.
	 *  Pure read — the re-arm lives in the constructor\'s effect. */
	get visible() {
		return (this.topic !== null || this.host !== null) && !this.#dismissed;
	}

	/** The keydown rung\'s gate — the rung itself also IME-gates (BC-8),
	 *  which stays the shell\'s job. */
	handles(): boolean {
		return this.topic !== null || this.shape;
	}

	/** Help keys: the card is information-only — Esc hides it while the
	 *  text keeps matching, Enter never sends a \'?\' line (with the card
	 *  up the press is already answered; dismissed, it re-opens). Returns
	 *  true when the key was handled; false falls through the ladder. */
	onKey(event: KeyboardEvent): boolean {
		if (event.key === 'Escape') {
			event.preventDefault();
			this.#dismissed = true;
			return true;
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			this.#dismissed = false;
			return true;
		}
		return false;
	}
}
