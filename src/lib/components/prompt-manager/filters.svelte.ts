import { isValidTagWord } from '$lib/services/chat/prompt-trigger.js';
import { loadTagFilter, saveTagFilter } from '$lib/utils/prompt-tag-prefs';

/**
 * PromptFilters — the filter machine of PromptManagerPanel (ADR-0022 W2):
 * ONE state behind two inputs (The Prompt Tags ADR 2026-09-14, D5/D11) —
 * the chip row's checked words and the search box's +word tokens — plus
 * the 300 ms debounce and the desk-slot persist/restore, moved whole
 * from the panel script.
 *
 * The panel constructs one instance per mount with the profile accessor
 * (the workspace desk) and a requestRefresh callback (the table
 * machine's refresh — no machine-to-machine import; the shell mediates).
 */
export class PromptFilters {
	searchQ = $state('');
	/** Active filter words — lowercased, grammar-valid, deduped. */
	tagFilter = $state<string[]>([]);
	readonly TAG_FILTER_KEY = 'dsi-prompt-tags-filter';
	searchTimer: ReturnType<typeof setTimeout> | null = null;
	profile: () => string | null;
	requestRefresh: () => void;

	constructor(profile: () => string | null, requestRefresh: () => void) {
		this.profile = profile;
		this.requestRefresh = requestRefresh;
	}

	/** Plain (un-prefixed) words of the search box — the q param. */
	plainWords(v: string): string {
		return v
			.split(/[\s;]+/)
			.filter((tok) => tok && !tok.startsWith('+'))
			.join(' ');
	}

	/** The q param value: plain words of the box, trimmed. */
	plainQuery(): string {
		return this.plainWords(this.searchQ).trim();
	}

	/** Rewrite the box's +tokens from the filter state, keeping plain words. */
	rewritePlusTokens() {
		const plain = this.plainWords(this.searchQ);
		this.searchQ = [...this.tagFilter.map((w) => '+' + w), ...(plain ? [plain] : [])].join(' ');
	}

	/** Chip toggle (and the +word path's shared tail): flip the word in the
	 *  filter, persist to the desk slot, mirror into the box, refresh. */
	toggleTag(word: string) {
		this.tagFilter = this.tagFilter.includes(word)
			? this.tagFilter.filter((w) => w !== word)
			: [...this.tagFilter, word];
		saveTagFilter(this.TAG_FILTER_KEY, this.tagFilter, this.profile());
		this.rewritePlusTokens();
		if (this.searchTimer) clearTimeout(this.searchTimer);
		this.searchTimer = setTimeout(() => this.requestRefresh(), 300);
	}

	/** D5 hard-reload restore: the desk slot is the authority; the box's
	 *  +tokens are reconstructed FROM it (the textual twin, D11). */
	restore() {
		this.tagFilter = loadTagFilter(this.TAG_FILTER_KEY, this.profile());
		if (this.tagFilter.length > 0) this.rewritePlusTokens();
	}

	onSearchInput() {
		// D11: parse the +tokens OUT of the box into the filter state (the
		// chips mirror them); grammar-invalid words are dropped silently.
		const parsed = this.searchQ
			.split(/[\s;]+/)
			.filter((tok) => tok.startsWith('+'))
			.map((tok) => tok.slice(1).toLowerCase())
			.filter((w) => w && isValidTagWord(w));
		const next: string[] = [];
		for (const w of parsed) if (!next.includes(w)) next.push(w);
		const changed =
			next.length !== this.tagFilter.length || next.some((w) => !this.tagFilter.includes(w));
		if (changed) {
			this.tagFilter = next;
			saveTagFilter(this.TAG_FILTER_KEY, this.tagFilter, this.profile());
		}
		if (this.searchTimer) clearTimeout(this.searchTimer);
		this.searchTimer = setTimeout(() => this.requestRefresh(), 300);
	}
}
