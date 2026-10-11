import { SvelteSet } from 'svelte/reactivity';
import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

type Row = SuggestedPrompt;

/**
 * PromptTable — the table machine of PromptManagerPanel (ADR-0022 W1):
 * rows/total/loading, the sort cycle, the selection Set, the refresh
 * fetch and the bulk delete, moved whole from the panel script.
 *
 * The panel constructs one instance per mount with three injected
 * accessors/callbacks (no machine-to-machine imports — the shell
 * mediates): the tag filter words and the plain query (owned by the
 * filter machine from W2), the onchanged host callback, and the error
 * strip setter (errorMsg stays in the shell until W3).
 */
export class PromptTable {
	rows = $state<Row[]>([]);
	total = $state(0);
	loading = $state(false);
	/** Sort state: null = unsorted (server default), else {col, dir}.
	 *  Clicking a column cycles: unsorted → asc → desc → unsorted. */
	sortState = $state<{ col: 'uses' | 'last_used' | 'display'; dir: 'asc' | 'desc' } | null>(null);
	/** Selected row ids (checkbox column). */
	selected = new SvelteSet<number>();
	tagFilterWords: () => string[];
	plainQuery: () => string;
	onchanged?: () => void;
	reportError?: (msg: string | null) => void;

	constructor(
		tagFilterWords: () => string[],
		plainQuery: () => string,
		onchanged?: () => void,
		reportError?: (msg: string | null) => void
	) {
		this.tagFilterWords = tagFilterWords;
		this.plainQuery = plainQuery;
		this.onchanged = onchanged;
		this.reportError = reportError;
	}

	/** Visible rows: the server-ordered list as loaded. */
	get visibleRows(): Row[] {
		return this.rows;
	}

	async refresh() {
		this.loading = true;
		this.reportError?.(null);
		const params = new URLSearchParams({ limit: '200' });
		if (this.sortState) {
			params.set('sort', this.sortState.col);
			params.set('dir', this.sortState.dir);
		} else {
			params.set('sort', 'last_used'); // server default
		}
		// D11 wire shape: plus-words and chips ride ONE request as the
		// tags param; plain words stay the old q. A plus-free query with
		// no chips is byte-identical to the old wire shape.
		const tags = this.tagFilterWords();
		if (tags.length > 0) params.set('tags', tags.join(','));
		const q = this.plainQuery();
		if (q) params.set('q', q);
		try {
			const res = await fetch(`/api/prompts?${params}`);
			if (!res.ok) {
				this.reportError?.('Failed to load');
				this.loading = false;
				return;
			}
			const data = (await res.json()) as { rows: Row[]; total: number };
			this.rows = data.rows;
			this.total = data.total;
		} catch {
			this.reportError?.('Network error');
		}
		this.loading = false;
	}

	toggleSelected(id: number) {
		if (this.selected.has(id)) this.selected.delete(id);
		else this.selected.add(id);
	}

	/** Bulk delete all selected — no confirmation (OCI parity). */
	async deleteSelected() {
		if (this.selected.size === 0) return;
		const ids = [...this.selected];
		try {
			await Promise.all(ids.map((id) => fetch(`/api/prompts/${id}`, { method: 'DELETE' })));
			this.selected.clear();
			this.onchanged?.();
			this.refresh();
		} catch {
			this.reportError?.('Network error');
		}
	}

	sortByCol(col: 'uses' | 'last_used' | 'display') {
		if (!this.sortState || this.sortState.col !== col) {
			this.sortState = { col, dir: 'asc' };
		} else if (this.sortState.dir === 'asc') {
			this.sortState = { col, dir: 'desc' };
		} else {
			this.sortState = null; // back to unsorted
		}
		this.refresh();
	}
}
