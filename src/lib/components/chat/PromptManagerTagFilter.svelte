<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	/**
	 * PromptManagerTagFilter — the vocabulary chip row of the prompts
	 * manager toolbar (The Prompt Tags ADR, 2026-09-14, D5): the CHIP view
	 * of the active filter state. The words come from /api/config
	 * prompts.tags (the operator's settings.yaml vocabulary); toggling a
	 * chip reports the word up — the HOST owns the state, its persistence
	 * (the dsi-prompt-tags-filter desk slot), and the search-box plus-word
	 * twins (D11).
	 */
	let {
		vocabulary,
		selected,
		ontoggle
	}: {
		vocabulary: string[];
		selected: string[];
		ontoggle: (word: string) => void;
	} = $props();
</script>

<div class="mgr-tag-row" role="group" aria-label={t(m.filterByTags)} title={t(m.filterByTags)}>
	{#each vocabulary as word (word)}
		<button
			type="button"
			class="mgr-tag-filter-chip"
			class:on={selected.includes(word)}
			aria-pressed={selected.includes(word)}
			onclick={() => ontoggle(word)}
		>{word}</button>
	{/each}
</div>

<style>
	.mgr-tag-row {
		display: flex;
		flex-wrap: wrap;
		width: 19rem;
		gap: 0.25rem;
		border-bottom: 1px solid rgba(139, 92, 246, 0.12);
	}
	.mgr-tag-filter-chip {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.625rem;
		background: var(--color-surface, #f8f9fa);
		color: var(--color-text-secondary, #495057);
		font-size: 0.6875rem;
		line-height: 1.25rem;
		padding: 0 0.5rem;
		cursor: pointer;
	}
	.mgr-tag-filter-chip:hover {
		background: var(--color-surface-alt, #f1f3f5);
	}
	.mgr-tag-filter-chip.on {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 14%, transparent);
		border-color: var(--color-accent-blue, #3b82f6);
		color: var(--color-accent-blue, #3b82f6);
		font-weight: 600;
	}
</style>
