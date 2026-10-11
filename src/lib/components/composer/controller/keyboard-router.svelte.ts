import type { StripController } from './suggest-controller.svelte';
import type { SlashController } from './slash-controller.svelte';
import type { HelpController } from './help-controller.svelte';

/** The router's wiring (ADR-0020 D2 as amended 2026-10-10): the shell
 *  constructs the router with the three surface controllers, the IME
 *  gate, and the submit ladder — the router owns NO surface, so the
 *  precedence it encodes stays a contract BETWEEN equals. */
export interface RouterDeps {
	strip: StripController;
	slash: SlashController;
	help: HelpController;
	/** IME composition state — suggest/slash/help keys pass through while
	 *  composing (BC-8); composition input events skip the debounce too. */
	isComposing(): boolean;
	/** The submit receipt ladder (BC-A3) — the router's final rung. */
	submit(): Promise<boolean>;
}

/**
 * KeyboardRouter — the composer's keypress ladder, extracted verbatim
 * (ADR-0020 D2 amendment, 2026-10-10). A NEUTRAL party: it owns no
 * surface and no draft — it offers each keypress to the machines in the
 * fixed order and lets unclaimed keys submit:
 *
 *   IME pass-through → strip (row-gated, BC-6) → run-shape re-arm (BC-9)
 *   → help (shape-owned) → slash (row-gated) → submit (BC-A3).
 *
 * The ORDER is the composer's identity; it lives here verbatim, one
 * rung per block, so a reader sees the whole precedence at a glance and
 * the rungs unit-test without rendering a composer.
 */
export class KeyboardRouter {
	#deps: RouterDeps;

	constructor(deps: RouterDeps) {
		this.#deps = deps;
	}

	async onKey(event: KeyboardEvent): Promise<void> {
		const { strip, slash, help } = this.#deps;
		const composing = this.#deps.isComposing();
		// ── Rung 1 — Suggest keys (BC-6: guard is EXACTLY trigger active &&
		// rows.length > 0 — ghost absent by construction; IME passes through,
		// BC-8). Enter press 1 accepts, press 2 sends (BC-2).
		const intercept =
			!composing &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			strip.handles();
		if (intercept) {
			if (event.key === 'Tab' && event.shiftKey) {
				if (strip.rows.length > 1) {
					event.preventDefault();
					strip.cycle(-1);
				}
				return;
			}
			if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
				event.preventDefault();
				strip.accept(strip.index);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				strip.close();
				return;
			}
			if (event.key === 'ArrowDown' && strip.rows.length > 1) {
				event.preventDefault();
				strip.cycle(1);
				return;
			}
			if (event.key === 'ArrowUp' && strip.rows.length > 1) {
				event.preventDefault();
				strip.cycle(-1);
				return;
			}
		}
		// ── Rung 2 — a run-shaped draft with no live rows is a macro
		// command standing by (BC-9 memoized, or the fetch has not landed):
		// Enter re-arms the strip instead of shipping the line — the help
		// card's own dismissed-reopen rule, extended to the fetch-driven
		// surface. A zero-match query re-arms to nothing (the strip stays
		// dark, the silent-degrade posture, BC-5) and the draft stays for
		// editing. Find-shape (`?`) keeps its pinned press-through: an
		// unmatched finder question submits as chat.
		if (!composing && strip.runRearmNeeded()) {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				strip.rearmRun();
				return;
			}
		}
		// ── Rung 3 — Command help keys (command-help, 2026-08-30): the card
		// is information-only — Esc hides it while the text keeps matching,
		// and Enter never sends a `?` help line: with the card up the press
		// is already answered; dismissed, it re-opens the card instead.
		// The shape owns its keys even while the catalog is still loading
		// (a `?` line must never ride the wire as bogus arguments).
		if (!composing && help.handles()) {
			if (help.onKey(event)) return;
		}
		// ── Rung 4 — Slash Menu keys (ADR "The Slash Menu", 2026-08-30):
		// ROW-GATED interception — the strip's shipped guard shape (matched
		// rows only). Tab/Enter accept the highlighted row, arrows cycle,
		// Esc dismisses. With zero matching rows (and while loading/failed)
		// Enter falls through to submit and the menu closes with the cleared
		// draft — unknown /nope ships as chat exactly as today; IME composes
		// pass through untouched (the strip's guard, verbatim).
		if (!composing && !event.metaKey && !event.ctrlKey && !event.altKey && slash.handles()) {
			if (event.key === 'Escape') {
				event.preventDefault();
				slash.memoize();
				return;
			}
			if (slash.rows.length > 0) {
				if (event.key === 'Tab' && event.shiftKey) {
					// The strip's Shift+Tab: cycle back; with one row the press
					// is swallowed (no focus escape from an open menu).
					event.preventDefault();
					if (slash.rows.length > 1) slash.cycle(-1);
					return;
				}
				if (event.key === 'ArrowDown' && slash.rows.length > 1) {
					event.preventDefault();
					slash.cycle(1);
					return;
				}
				if (event.key === 'ArrowUp' && slash.rows.length > 1) {
					event.preventDefault();
					slash.cycle(-1);
					return;
				}
				// Tab and Enter are the SAME accept (the strip's rule): the
				// kind-aware pick — gesture/hint/skill insert the seed (the
				// operator's own Enter is press 2), a hint-less command
				// executes. Tab never moves focus while rows intercept it.
				if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
					event.preventDefault();
					slash.pickHighlighted();
					return;
				}
			}
		}
		// ── Final rung — submit (Enter sends; Shift+Enter is a newline the
		// textarea keeps).
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			await this.#deps.submit();
		}
	}
}
