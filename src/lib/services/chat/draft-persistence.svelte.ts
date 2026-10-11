/**
 * Draft persistence — the composer's debounced save/clear timer, extracted
 * from Composer.svelte (ADR-0018 D4 wave 3, task 3.1).
 *
 * Contract (unchanged from the inline implementation):
 * - An EMPTIED draft clears SYNCHRONOUSLY — send / macro run-accept must
 *   never let a submitted prompt resurrect from storage.
 * - Non-empty input saves on a debounce (typing bursts coalesce).
 * - `flush` cancels the pending timer and persists the CURRENT value at
 *   teardown time (an HMR strike or panel close inside the debounce window
 *   keeps the tail; an element removed mid-HMR fires no blur, so the
 *   focused flag is the caller's last-known, never a live DOM read).
 *
 * Instance-scoped, NOT a singleton: one composer instance owns one timer
 * (D2 — per-instance state stays instantiated by its component).
 */
import { clearDraft, saveDraft } from '$lib/utils/draft-prefs';

export class DraftPersistence {
	#timer: ReturnType<typeof setTimeout> | null = null;
	readonly #debounceMs: number;

	constructor(debounceMs = 400) {
		this.#debounceMs = debounceMs;
	}

	/** Cancel any pending debounced save (no write). */
	cancel(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
	}

	/** The typing path: debounce the save; empty clears synchronously.
	 *  The focus flag is read LAZILY at fire time (a getter, not a value):
	 *  the original inline closure read the live flag when the timer fired,
	 *  so a focus landing mid-window still saves as focused. */
	schedule(sessionId: string, text: string, isFocused: () => boolean): void {
		this.cancel();
		if (text.length === 0) {
			clearDraft(sessionId);
			return;
		}
		this.#timer = setTimeout(() => {
			this.#timer = null;
			saveDraft(sessionId, text, isFocused());
		}, this.#debounceMs);
	}

	/** The teardown / submit path: cancel + write the CURRENT value now. */
	flush(sessionId: string, value: string, focused: boolean): void {
		this.cancel();
		if (value.length > 0) saveDraft(sessionId, value, focused);
		else clearDraft(sessionId);
	}

	get pending(): boolean {
		return this.#timer !== null;
	}
}
