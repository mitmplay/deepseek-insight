<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * PromptManagerPanel — the CONTENT of the prompts manager (extracted
	 * 2026-09-06 from PromptsManagerDialog ln 256-442): sticky toolbar +
	 * head table, error strip, add-row, body table, footer — plus the
	 * edit dialog, which travels with the panel because its form state
	 * (editingRow/editText/…) is the table's own.
	 *
	 * Presentational: rows arrive via /api/prompts fetch, the panel owns
	 * inline-edit + search + sort + selection state. Callbacks: onclose
	 * (Escape with nothing open — the dialog's backdrop/× own the other
	 * close gestures), onchanged (CRUD happened — host refreshes nothing
	 * eagerly; the strip refetches on the next trigger).
	 *
	 * ALL data flows through the HTTP contract — this component never
	 * imports db.ts (no cross-module bleed; the manager and the strip
	 * family meet only at /api/prompts).
	 */
	import { onMount } from 'svelte';
	import PromptManagerTDLabel from './PromptManagerTDLabel.svelte';
	import PromptManagerSearch from './PromptManagerSearch.svelte';
	import PromptManagerTDTags from './PromptManagerTDTags.svelte';
	import PromptManagerTagFilter from './PromptManagerTagFilter.svelte';
	import PromptManagerTDUses from './PromptManagerTDUses.svelte';
	import PromptManagerEdit from './PromptManagerEdit.svelte';
	import PromptManagerAdd from './PromptManagerAdd.svelte';
	import { isValidTagWord, parseTagWords, type SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';
	import { appConfig, loadAppConfig } from '$lib/services/config/app-config.svelte';
	import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import { loadTagFilter, saveTagFilter } from '$lib/utils/prompt-tag-prefs';

	type Row = SuggestedPrompt;

	let {
		onclose,
		onchanged,
		escapeScope = 'window',
		host = 'modal'
	}: {
		onclose: () => void;
		onchanged?: () => void;
		/** Escape scope (ADR D3/W4): 'window' — the modal default, one
		 *  global listener closes the (single) manager; 'root' — the
		 *  EMBEDDED host: the panel's own root listens, so two managers
		 *  on the floor each close only themselves. */
		escapeScope?: 'window' | 'root';
		/** Host shape (W4, ADR D8): 'modal' — the default, PromptsManagerDialog
		 *  geometry byte-identical; 'panel' — an embedded floor slot: the edit
		 *  dialog pair portals to document.body (the Loupe/BC-7 pattern —
		 *  fixed layers escape the floor's zoom transform) and the sticky
		 *  header bleeds by --mgr-bleed (default 1rem = the modal rule). */
		host?: 'modal' | 'panel';
	} = $props();

	let rows = $state<Row[]>([]);
	let total = $state(0);
	let searchQ = $state('');
	/** Sort state: null = unsorted (server default), else {col, dir}.
	 *  Clicking a column cycles: unsorted → asc → desc → unsorted. */
	let sortState = $state<{ col: 'uses' | 'last_used' | 'display'; dir: 'asc' | 'desc' } | null>(null);
	let loading = $state(false);
	let editingId = $state<number | null>(null);
	/** The row being edited — its table row stays highlighted while the
	 *  edit dialog is open (OCI user spec 2026-08-14). */
	let editingRow = $state<Row | null>(null);
	let editText = $state('');
	let editLabel = $state('');
	let editUses = $state('1');
	let editMacro = $state(false);
	let editTags = $state('');
	let addingNew = $state(false);
	let newText = $state('');
	let newLabel = $state('');
	let newTags = $state('');
	// Add-dialog uses/macro seeds (aligned with the Edit dialog's contract):
	// defaults mirror createPrompt's own insert defaults (1 / not-macro).
	let newUses = $state('1');
	let newMacro = $state(false);
	let errorMsg = $state<string | null>(null);
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	// ── Tag filter (The Prompt Tags ADR, 2026-09-14, D5/D11) ──
	// ONE state behind two inputs: the chip row's checked words and the
	// search box's +word tokens. Persisted per profile desk.
	const profile = $derived(getWorkspaceState()?.profile ?? null);
	/** The operator's vocabulary (settings.yaml prompts.tags via /api/config). */
	const vocabulary = $derived(appConfig().prompts.tags);
	/** Active filter words — lowercased, grammar-valid, deduped. */
	let tagFilter = $state<string[]>([]);
	const TAG_FILTER_KEY = 'dsi-prompt-tags-filter';

	/** Plain (un-prefixed) words of the search box — the q param. */
	function plainWords(v: string): string {
		return v
			.split(/[\s;]+/)
			.filter((tok) => tok && !tok.startsWith('+'))
			.join(' ');
	}

	/** Rewrite the box's +tokens from the filter state, keeping plain words. */
	function rewritePlusTokens() {
		const plain = plainWords(searchQ);
		searchQ = [...tagFilter.map((w) => '+' + w), ...(plain ? [plain] : [])].join(' ');
	}

	/** Chip toggle (and the +word path's shared tail): flip the word in the
	 *  filter, persist to the desk slot, mirror into the box, refresh. */
	function toggleTag(word: string) {
		tagFilter = tagFilter.includes(word)
			? tagFilter.filter((w) => w !== word)
			: [...tagFilter, word];
		saveTagFilter(TAG_FILTER_KEY, tagFilter, profile);
		rewritePlusTokens();
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(refresh, 300);
	}
	/** Selected row ids (checkbox column). */
	let selected = $state<Set<number>>(new Set());

	onMount(() => {
		loadAppConfig(); // vocabulary rides the singleton config load
		// D5 hard-reload restore: the desk slot is the authority; the box's
		// +tokens are reconstructed FROM it (the textual twin, D11).
		tagFilter = loadTagFilter(TAG_FILTER_KEY, profile);
		if (tagFilter.length > 0) rewritePlusTokens();
		refresh();
	});

	async function refresh() {
		loading = true;
		errorMsg = null;
		try {
			const params = new URLSearchParams({ limit: '200' });
			if (sortState) {
				params.set('sort', sortState.col);
				params.set('dir', sortState.dir);
			} else {
				params.set('sort', 'last_used'); // server default
			}
			// D11 wire shape: plus-words and chips ride ONE request as the
			// tags param; plain words stay the old q. A plus-free query with
			// no chips is byte-identical to the old wire shape.
			if (tagFilter.length > 0) params.set('tags', tagFilter.join(','));
			const q = plainWords(searchQ).trim();
			if (q) params.set('q', q);
			const res = await fetch(`/api/prompts?${params}`);
			if (!res.ok) {
				errorMsg = 'Failed to load';
				return;
			}
			const data = (await res.json()) as { rows: Row[]; total: number };
			rows = data.rows;
			total = data.total;
		} catch {
			errorMsg = 'Network error';
		}
		loading = false;
	}

	function onSearchInput() {
		// D11: parse the +tokens OUT of the box into the filter state (the
		// chips mirror them); grammar-invalid words are dropped silently.
		const parsed = searchQ
			.split(/[\s;]+/)
			.filter((tok) => tok.startsWith('+'))
			.map((tok) => tok.slice(1).toLowerCase())
			.filter((w) => w && isValidTagWord(w));
		const next = [...new Set(parsed)];
		const changed =
			next.length !== tagFilter.length || next.some((w) => !tagFilter.includes(w));
		if (changed) {
			tagFilter = next;
			saveTagFilter(TAG_FILTER_KEY, tagFilter, profile);
		}
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(refresh, 300);
	}

	function toggleSelected(id: number) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	/** Visible rows: the server-ordered list as loaded. */
	let visibleRows = $derived(rows);

	/** Bulk delete all selected — no confirmation (OCI parity). */
	async function deleteSelected() {
		if (selected.size === 0) return;
		const ids = [...selected];
		try {
			await Promise.all(ids.map((id) => fetch(`/api/prompts/${id}`, { method: 'DELETE' })));
			selected = new Set();
			onchanged?.();
			refresh();
		} catch {
			errorMsg = 'Network error';
		}
	}

	function sortByCol(col: 'uses' | 'last_used' | 'display') {
		if (!sortState || sortState.col !== col) {
			sortState = { col, dir: 'asc' };
		} else if (sortState.dir === 'asc') {
			sortState = { col, dir: 'desc' };
		} else {
			sortState = null; // back to unsorted
		}
		refresh();
	}

	/** Direction icon for a column header. */
	function sortIcon(col: 'uses' | 'last_used' | 'display'): string {
		if (!sortState || sortState.col !== col) return '↕';
		return sortState.dir === 'asc' ? '▲' : '▼';
	}

	function startEdit(row: Row) {
		editingId = row.id;
		editingRow = row;
		editText = row.text;
		editLabel = row.label ?? '';
		editUses = String(row.use_count);
		editMacro = row.macro === 1;
		editTags = row.tags ?? '';
	}

	function cancelEdit() {
		editingId = null;
		editingRow = null;
	}

	async function saveEdit(id: number) {
		const row = editingRow ?? rows.find((r) => r.id === id);
		if (!row) {
			cancelEdit();
			return;
		}
		const body: Record<string, unknown> = {};
		if (editText !== row.text) body.text = editText;
		if ((editLabel || null) !== (row.label ?? null)) {
			body.label = editLabel.trim() || null;
		}
		const uses = parseInt(editUses, 10);
		if (!isNaN(uses) && uses !== row.use_count) body.use_count = uses;
		if (editMacro !== (row.macro === 1)) body.macro = editMacro;
		if (editTags.trim() !== (row.tags ?? '')) body.tags = editTags;
		if (Object.keys(body).length === 0) {
			cancelEdit();
			return;
		}
		try {
			const res = await fetch(`/api/prompts/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				errorMsg = (err as { error?: string }).error || 'Save failed';
				return;
			}
			cancelEdit();
			onchanged?.();
			refresh();
		} catch {
			errorMsg = 'Network error';
		}
	}


	/** Inline toggle: flip the macro flag without the edit dialog. */
	async function toggleMacro(row: Row) {
		try {
			const res = await fetch(`/api/prompts/${row.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ macro: row.macro !== 1 })
			});
			if (!res.ok) {
				errorMsg = 'Save failed';
				return;
			}
			row.macro = row.macro === 1 ? 0 : 1;
			onchanged?.();
		} catch {
			errorMsg = 'Network error';
		}
	}
	async function addPrompt() {
		if (!newText.trim()) return;
		try {
			const res = await fetch('/api/prompts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
				text: newText,
				label: newLabel || undefined,
				use_count: (() => { const n = parseInt(newUses, 10); return !isNaN(n) && n !== 1 ? n : undefined; })(),
				macro: newMacro ? true : undefined,
				tags: parseTagWords(newTags).length > 0 ? parseTagWords(newTags) : undefined
			})
			});
			if (res.status === 409) {
				const err = (await res.json()) as { existing?: { use_count?: number } };
				errorMsg = `Already saved (${err.existing?.use_count ?? '?'} uses)`;
				return;
			}
			if (!res.ok) {
				errorMsg = 'Add failed';
				return;
			}
			addingNew = false;
			newText = '';
			newLabel = '';
			newTags = '';
			newUses = '1';
			newMacro = false;
			errorMsg = null;
			onchanged?.();
			refresh();
		} catch {
			errorMsg = 'Network error';
		}
	}

	/** Escape closes the manager only when no sub-form is open (the
	 *  edit dialog and the add-row keep their own text). Scope per the
	 *  escapeScope prop: the window listener runs for the modal host only
	 *  (ADR D3 — per-mount window listeners multiply with embedded
	 *  instances); the embedded root listens on its own element. */
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && !addingNew && editingId === null) {
			e.stopPropagation();
			onclose();
		}
	}
</script>

<!-- One window listener, gated by scope (D3): the modal host ('window')
     registers it; the embedded host ('root') leaves it ABSENT — its own
     root element listens below, so N managers never multiply window
     listeners. -->
<svelte:window onkeydown={escapeScope === 'window' ? onKeydown : undefined} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- The root-scoped Escape target (D3/W4): a composite region, not a
     control — the keydown closes the manager when no sub-form is open,
     and focus reaches it through the column's focus-follow selection. -->
<div
	class="mgr-panel-root"
	role="region"
	aria-label={t(m.promptsManager)}
	tabindex={escapeScope === 'root' ? -1 : undefined}
	onkeydown={escapeScope === 'root' ? onKeydown : undefined}
>
	<!-- Sticky header (OCI user spec 2026-08-14): toolbar row + table-head
	     row, no gaps, stays pinned while the table body scrolls. -->
	<div class="mgr-sticky">
		<div class="mgr-sticky-bar">
			<button
				type="button"
				class="mgr-btn mgr-btn-danger"
				disabled={selected.size === 0}
				onclick={deleteSelected}
				title={selected.size > 0 ? `Delete ${selected.size} selected` : 'Select rows to enable delete'}
			>
				{t(m.del)}{selected.size > 0 ? ` (${selected.size})` : ''}
			</button>
			<div class="mgr-toolbar">
    			{#if vocabulary.length > 0}
    				<!-- D5: the CHIP view of the active filter — the search box's
    			     +tokens are the same state seen from the other input. -->
    				<PromptManagerTagFilter {vocabulary} selected={tagFilter} ontoggle={toggleTag} />
    			{/if}
				<PromptManagerSearch bind:value={searchQ} oninput={onSearchInput} />
				{#if addingNew}
					<button
						type="button"
						class="mgr-btn mgr-btn-cancel"
						onclick={() => {
							addingNew = false;
							newText = '';
							newLabel = '';
							newTags = '';
							errorMsg = null;
						}}
					>
						{t(m.cancel)}
					</button>
				{:else}
					<button
						type="button"
						class="mgr-btn mgr-btn-add"
						onclick={() => {
							addingNew = true;
							errorMsg = null;
						}}
					>
						{t(m.plusAdd)}
					</button>
				{/if}
			</div>
		</div>

		{#if !loading && rows.length > 0}
			<table class="mgr-table mgr-head-table">
				<thead>
					<tr>
						<th class="mgr-sel-col">
							{#if selected.size > 0}
								<button
									type="button"
									class="mgr-unselect-all"
									onclick={() => {
										selected = new Set();
									}}
									title={t(m.unselectAll)}
								>
									☐
								</button>
							{/if}
						</th>
						<th>
							<button
								type="button"
								class="mgr-sort-btn"
								class:active={sortState?.col === 'uses'}
								onclick={() => sortByCol('uses')}
							>
								{t(m.uses)} {sortIcon('uses')}
							</button>
						</th>
						<th>
							<button
								type="button"
								class="mgr-sort-btn"
								class:active={sortState?.col === 'display'}
								onclick={() => sortByCol('display')}
							>
								{t(m.labelSlashText)} {sortIcon('display')}
							</button>
						</th>
						<th class="mgr-macro-col">{t(m.macro)}</th>
						<th class="mgr-tags-col">{t(m.tags)}</th>
					</tr>
				</thead>
			</table>
		{/if}
	</div>

	{#if errorMsg}
		<div class="mgr-error">{errorMsg}</div>
	{/if}

	{#if addingNew}
		<!-- Add-row extracted to PromptManagerAdd (D8 seam): the panel keeps
		     addingNew + the POST; the component owns the form. -->
		<PromptManagerAdd
			bind:uses={newUses}
			bind:macro={newMacro}
			bind:text={newText}
			bind:label={newLabel}
			bind:tags={newTags}
			portal={host === 'panel'}
			onsave={addPrompt}
			oncancel={() => {
				addingNew = false;
				newText = '';
				newLabel = '';
				newTags = '';
				newUses = '1';
				newMacro = false;
				errorMsg = null;
			}}
		/>
	{/if}

	{#if loading}
		<div class="mgr-loading">{t(m.loading)}</div>
	{:else if rows.length === 0}
		<div class="mgr-empty">{searchQ ? t(m.noPromptsMatch) : t(m.noPromptsYet)}</div>
	{:else}
		<table class="mgr-table mgr-body-table">
			<tbody>
				{#each visibleRows as row (row.id)}
					{#if editingId === row.id}
						<!-- Editing: row highlighted, fields live in the dialog form.
						     The row is INERT (D9) — the dialog is the only edit surface. -->
						<tr class="mgr-editing">
							<td></td>
							<td>{row.use_count}</td>
							<PromptManagerTDLabel {row} />
							<td class="mgr-macro-col">{row.macro === 1 ? '✓' : '—'}</td>
							<PromptManagerTDTags {row} />
						</tr>
					{:else}
						<!-- D9: the ROW is the edit affordance — a body-row click opens
						     the edit dialog; the checkbox cell is EXEMPT (selection-only).
						     The tr/td handlers are pointer-only supplements to the dialog's
						     own keyboard path (its Save/Cancel are real buttons). -->
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<tr class:sel={selected.has(row.id)} onclick={() => startEdit(row)}>
							<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
							<td
								class="mgr-sel-col"
								onclick={(e) => e.stopPropagation()}
							>
								<input
									type="checkbox"
									class="mgr-check"
									checked={selected.has(row.id)}
									onchange={() => toggleSelected(row.id)}
									aria-label="Select prompt"
								/>
							</td>
							<PromptManagerTDUses {row} />
							<PromptManagerTDLabel {row} />
							<td class="mgr-macro-col">
								<button
									type="button"
									class="mgr-macro-toggle"
									class:on={row.macro === 1}
									aria-pressed={row.macro === 1}
									title={row.macro === 1 ? 'Macro — click to turn off' : 'Not a macro — click to turn on'}
									onclick={(e) => { e.stopPropagation(); toggleMacro(row); }}
								>{row.macro === 1 ? '✓' : '—'}</button
								>
							</td>
							<PromptManagerTDTags {row} />
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
		{#if total > rows.length}
			<div class="mgr-footer">{total - rows.length} {t(m.moreRefine)}</div>
		{/if}
	{/if}
</div>

{#if editingRow}
	<!-- Edit dialog extracted to PromptManagerEdit (D8 seam): the panel keeps
	     the dialog STATE (editUses/editMacro/editLabel/editText via $bindable),
	     the component owns the form + portal pair. -->
	<PromptManagerEdit
		row={editingRow}
		bind:uses={editUses}
		bind:macro={editMacro}
		bind:label={editLabel}
		bind:text={editText}
		bind:tags={editTags}
		portal={host === 'panel'}
		onsave={() => saveEdit(editingRow!.id)}
		oncancel={cancelEdit}
	/>
{/if}

<style>
	/* Sticky header — one wrapper, two rows (toolbar + table head), zero gaps.
	   Sticks to the modal's scroll top so the whole header stays visible.
	   Bleed rides --mgr-bleed (W4): the modal rule's 1rem is the DEFAULT —
	   the embedded host overrides the var to match its own padding. */
	.mgr-sticky {
		position: sticky;
		top: 0;
		z-index: 5;
		margin: 0 calc(-1 * var(--mgr-bleed, 1rem)); /* bleed to the host's edges, flush with borders */
		background: var(--color-surface-elevated, #fff);
		box-shadow: 0 1px 4px rgba(139, 92, 246, 0.08);
	}

	/* Title + close live in the PromptsManagerDialog shell header now;
	   the panel's sticky bar carries only the toolbar. */
	.mgr-sticky-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 1.25rem;
	}
	.mgr-head-table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
		margin: 0;
		border: none;
		border-radius: 0;
		background: transparent;
	}
	.mgr-head-table thead th {
		border-left: none;
		border-right: none;
	}
	.mgr-head-table th {
		text-align: left;
		padding: 0.35em 0.6em;
		border: 1px solid rgba(139, 92, 246, 0.15);
		background: rgba(139, 92, 246, 0.12);
		color: var(--color-text-primary);
		font-weight: 600;
		font-size: 0.6875rem;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.mgr-unselect-all {
		border: none;
		background: transparent;
		cursor: pointer;
		font-size: 0.875rem;
		color: var(--color-text-muted, #888);
		padding: 0;
		line-height: 1;
	}
	.mgr-unselect-all:hover {
		color: var(--color-accent-blue, #3b82f6);
	}

	.mgr-toolbar {
		display: flex;
		flex: 1; /* occupy the sticky bar's empty space (search flex-fills inside) */
		gap: 0.25rem;
		align-items: center;
	}

	.mgr-btn {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		cursor: pointer;
		background: var(--color-surface, #f8f9fa);
	}
	.mgr-btn:hover {
		background: var(--color-surface-alt, #f1f3f5);
	}
	.mgr-btn-add {
		color: var(--color-accent-blue, #3b82f6);
	}
	.mgr-btn-cancel {
		color: var(--color-text-muted, #888);
	}
	.mgr-btn-danger {
		color: #dc2626;
	}
	.mgr-btn-danger:disabled {
		opacity: 0.4;
		cursor: not-allowed;
		color: var(--color-text-muted, #888);
	}
	.mgr-error {
		padding: 0.375rem 0.5rem;
		margin-bottom: 0.5rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 0.25rem;
		color: #dc2626;
	}

	/* Add-row styles moved to PromptManagerAdd.svelte */

	/* Markdown-table theme (mirrors .md-content table in app.css) */
	.mgr-table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
		margin: 0 0 0.5em 0;
		background: rgba(139, 92, 246, 0.04);
		border: 1px solid rgba(139, 92, 246, 0.2);
		border-radius: 0.5em;
		overflow: hidden;
	}
	/* Column width contract shared by head + body tables. The td half is
	   :global because the body cells come from child components
	   (PromptManagerTDUses/TDLabel) and carry no panel scope class —
	   without it, fixed layout re-splits those columns (310px regression). */
	.mgr-table th:nth-child(1),
	.mgr-table :global(td:nth-child(1)) {
		width: 2rem;
	}
	.mgr-table th:nth-child(2),
	.mgr-table :global(td:nth-child(2)) {
		width: 4rem;
	}
	.mgr-table th:nth-child(3),
	.mgr-table :global(td:nth-child(3)) {
		width: auto;
	}
	.mgr-table th:nth-child(4),
	.mgr-table :global(td:nth-child(4)) {
		width: 3.5rem; /* Macro: title-width only; the space goes to label/text */
	}
	/* nth-child(5) — the tags column (The Prompt Tags D4) — has NO width
	   entry: it inherits the leftover of the fixed layout, and the contract
	   drops from five pinned widths to four. */
	.mgr-table th {
		text-align: left;
		padding: 0.375rem 0.5rem;
		border-bottom: 1px solid var(--color-surface-border, #dee2e6);
		font-weight: 600;
		font-size: 0.6875rem;
		text-transform: uppercase;
		color: var(--color-text-muted, #888);
		white-space: nowrap;
	}
	.mgr-table td {
		padding: 0.35em 0.6em;
		border: 1px solid rgba(139, 92, 246, 0.15);
		text-align: left;
		vertical-align: top;
	}
	.mgr-body-table tbody tr:nth-child(even) {
		background: rgba(139, 92, 246, 0.03);
	}
	.mgr-body-table tbody tr:hover td {
		background: rgba(139, 92, 246, 0.08);
	}
	.mgr-table tr.sel td {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 14%, rgba(139, 92, 246, 0.04));
	}

	.mgr-sel-col {
		width: 2rem;
	}
	.mgr-check {
		cursor: pointer;
		accent-color: var(--color-accent-blue, #3b82f6);
	}

	.mgr-sort-btn {
		border: none;
		background: transparent;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-transform: inherit;
	}
	.mgr-sort-btn.active {
		color: var(--color-accent-blue, #3b82f6);
	}


	.mgr-macro-toggle {
		border: none;
		background: transparent;
		cursor: pointer;
		font-size: 0.75rem;
		line-height: 1;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		color: var(--color-text-muted, #888);
	}
	.mgr-macro-toggle:hover {
		background: var(--color-surface-alt, #f1f3f5);
	}
	.mgr-macro-toggle.on {
		color: var(--color-accent-blue, #3b82f6);
		font-weight: 600;
	}
	.mgr-macro-col {
		white-space: nowrap;
		text-align: center;
		color: var(--color-text-muted, #888);
		font-size: 0.75rem;
	}
	.mgr-tags-col {
		width: 10rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Row being edited — highlighted while the dialog is open.
	   Dialog chrome lives in PromptManagerEdit.svelte now. */
	.mgr-editing td {
		background: rgba(139, 92, 246, 0.16) !important;
	}

	.mgr-footer {
		padding: 0.5rem;
		text-align: center;
		color: var(--color-text-muted, #888);
		font-size: 0.6875rem;
	}

	.mgr-loading,
	.mgr-empty {
		padding: 2rem;
		text-align: center;
		color: var(--color-text-muted, #888);
	}
</style>
