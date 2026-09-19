<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import PromptManagerTagFilter from './PromptManagerTagFilter.svelte';
	import PromptManagerSearch from './PromptManagerSearch.svelte';

	/**
	 * PromptManagerHeader — the header of the prompts manager (the former
	 * PromptManagerStickyHeader, 2026-09-19 rework): toolbar row
	 * (delete-selected, tag chips, search, add/cancel) + the head table
	 * row, no gaps. NOT position:sticky anymore — the panel is a flex
	 * column and the header simply sits on top in normal flow; the
	 * PromptManagerContainer BELOW it owns the scroll.
	 *
	 * Presentational: state lives in the panel and arrives via props;
	 * every gesture is reported back through a callback. searchQ is
	 * $bindable (the search box owns keystrokes, the panel owns the
	 * value — it derives the +token filter from it).
	 */
	import PromptManagerToolbar from './PromptManagerToolbar.svelte';

	let {
		selectedCount,
		vocabulary,
		tagFilter,
		dbPath,
		container,
		sortState,
		loading,
		hasRows,
		addingNew,
		searchQ = $bindable(''),
		textMode = $bindable('pre'),
		ontoggle,
		onsearchinput,
		ondeleteselected,
		onunselectall,
		onsort,
		onadd,
		oncanceladd
	}: {
		selectedCount: number;
		/** The operator's vocabulary (settings.yaml prompts.tags). */
		vocabulary: string[];
		/** The prompts.sqlite full path — the toolbar row's left label. */
		dbPath: string;
		/** The panel root element — the canvas-copy capture target. */
		container: HTMLElement | null | undefined;
		/** Active filter words — the chips mirror the box's +tokens. */
		tagFilter: string[];
		sortState: { col: 'uses' | 'last_used' | 'display'; dir: 'asc' | 'desc' } | null;
		loading: boolean;
		hasRows: boolean;
		addingNew: boolean;
		searchQ?: string;
		/** Label/text cell mode (2026-09-19): 'norm' | 'pre' — the
		 *  (norm|pre) segmented toggle lives at the head row's right. */
		textMode?: 'norm' | 'pre';
		ontoggle: (word: string) => void;
		onsearchinput: () => void;
		ondeleteselected: () => void;
		onunselectall: () => void;
		onsort: (col: 'uses' | 'last_used' | 'display') => void;
		onadd: () => void;
		oncanceladd: () => void;
	} = $props();

	/** Direction icon for a column header. */
	function sortIcon(col: 'uses' | 'last_used' | 'display'): string {
		if (!sortState || sortState.col !== col) return '↕';
		return sortState.dir === 'asc' ? '▲' : '▼';
	}
</script>

<!-- Sticky header (OCI user spec 2026-08-14): toolbar row + table-head
     row, no gaps, stays pinned while the table body scrolls. -->
<div class="mgr-header">
	<!-- First child: the path/copy toolbar row (2026-09-19). -->
	<PromptManagerToolbar {dbPath} {container} />

	<div class="mgr-header-bar">
		<button
			type="button"
			class="mgr-btn mgr-btn-danger"
			disabled={selectedCount === 0}
			onclick={ondeleteselected}
			title={selectedCount > 0 ? `Delete ${selectedCount} selected` : 'Select rows to enable delete'}
		>
			{t(m.del)}{selectedCount > 0 ? ` (${selectedCount})` : ''}
		</button>
		<div class="mgr-toolbar">
			{#if vocabulary.length > 0}
				<!-- D5: the CHIP view of the active filter — the search box's
			     +tokens are the same state seen from the other input. -->
				<PromptManagerTagFilter {vocabulary} selected={tagFilter} ontoggle={ontoggle} />
			{/if}
			<PromptManagerSearch bind:value={searchQ} oninput={onsearchinput} />
			{#if addingNew}
				<button type="button" class="mgr-btn mgr-btn-cancel" onclick={oncanceladd}>
					{t(m.cancel)}
				</button>
			{:else}
				<button type="button" class="mgr-btn mgr-btn-add" onclick={onadd}>
					{t(m.plusAdd)}
				</button>
			{/if}
		</div>
	</div>

	{#if !loading && hasRows}
		<table class="mgr-table mgr-head-table">
			<thead>
				<tr>
					<th class="mgr-sel-col">
						{#if selectedCount > 0}
							<button
								type="button"
								class="mgr-unselect-all"
								onclick={onunselectall}
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
							onclick={() => onsort('uses')}
						>
							{t(m.uses)} {sortIcon('uses')}
						</button>
					</th>
					<th>
						<button
							type="button"
							class="mgr-sort-btn"
							class:active={sortState?.col === 'display'}
							onclick={() => onsort('display')}
						>
							{t(m.labelSlashText)} {sortIcon('display')}
						</button>
					</th>
					<th class="mgr-macro-col" title={t(m.macro)}>{t(m.macroShort)}</th>
					<th class="mgr-tags-col">
						<span class="mgr-tags-head">
							{t(m.tags)}
							<!-- (pre|norm) segmented toggle — the head row's right end;
							     'pre' (the default) shows the raw text, 5 lines then
							     scroll; 'norm' is the flowing preview. -->
							<span class="mgr-mode-seg" role="group" aria-label={t(m.labelSlashTextMode)}>
								<button
									type="button"
									class="mgr-mode-btn left"
									class:on={textMode === 'pre'}
									aria-pressed={textMode === 'pre'}
									title={t(m.modeRawTitle)}
									onclick={() => (textMode = 'pre')}
								>pre</button
								><button
									type="button"
									class="mgr-mode-btn right"
									class:on={textMode === 'norm'}
									aria-pressed={textMode === 'norm'}
									title={t(m.modeNormTitle)}
									onclick={() => (textMode = 'norm')}
								>norm</button>
							</span>
						</span>
					</th>
				</tr>
			</thead>
		</table>
	{/if}
</div>

<style>
	/* Header — one wrapper, two rows (toolbar + table head), zero gaps.
	   NOT sticky (2026-09-19): normal flow at the panel's top; the
	   PromptManagerContainer below owns the scroll. The bleed margins
	   and --mgr-bleed went with the sticky behavior — the header spans
	   the panel's content box like any other row. */
	.mgr-header {
		flex: none; /* never scrolls — the container below does */
		background: var(--color-surface-elevated, #fff);
		box-shadow: 0 1px 4px rgba(139, 92, 246, 0.08);
	}

	/* Title + close live in the PromptsManagerDialog shell header now;
	   the panel's header bar carries only the toolbar. */
	.mgr-header-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.2rem 0.5rem;
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
	/* Column width contract, th half (the td half stays in the panel —
	   the body table is still panel-scoped). Mirrors the panel's
	   .mgr-table th:nth-child rules so head + body keep splitting the
	   fixed layout the same way. */
	.mgr-head-table th:nth-child(1) {
		width: 2rem;
	}
	.mgr-head-table th:nth-child(2) {
		width: 2.5rem; /* 'USES' header + up to 3-digit counts; the rest goes to label/text */
	}
	.mgr-head-table th:nth-child(3) {
		width: auto;
	}
	.mgr-head-table th:nth-child(4) {
		width: 2.25rem; /* Macro: 'MCR' title-width only; the space goes to label/text */
	}
	/* nth-child(5) — the tags column (The Prompt Tags D4) — has NO width
	   entry: it inherits the leftover of the fixed layout. */
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

	.mgr-tags-col {
		width: 10rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mgr-tags-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem;
	}
	/* (norm|pre) segmented pair — the SessionFilterToggle joined-pill
	   grammar: zero gap, outer curves only, selected = accent blue. */
	.mgr-mode-seg {
		display: inline-flex;
		flex-shrink: 0;
	}
	.mgr-mode-btn {
		border: 1px solid var(--color-surface-border, #dee2e6);
		background: var(--color-surface, #f8f9fa);
		color: var(--color-text-muted, #888);
		font-size: 0.5625rem;
		line-height: 1;
		padding: 0.125rem 0.3rem;
		cursor: pointer;
	}
	.mgr-mode-btn.left {
		border-top-left-radius: 9999px;
		border-bottom-left-radius: 9999px;
	}
	.mgr-mode-btn.right {
		border-top-right-radius: 9999px;
		border-bottom-right-radius: 9999px;
		border-left-width: 0;
	}
	.mgr-mode-btn.on {
		background: var(--color-accent-blue, #3b82f6);
		border-color: var(--color-accent-blue, #3b82f6);
		color: #fff;
		font-weight: 600;
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
</style>
