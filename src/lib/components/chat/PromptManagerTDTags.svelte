<script lang="ts">
	import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

	/**
	 * PromptManagerTDTags — the tags body cell (The Prompt Tags ADR,
	 * 2026-09-14, D4; the TDUses/TDLabel cell seam). Up to TWO tag chips
	 * inline, then a +n overflow badge whose title carries the FULL list —
	 * two is the widest honest fit under the fixed column-width contract.
	 * Untagged ('') renders the em-dash, same as the macro column.
	 */
	let { row }: { row: SuggestedPrompt } = $props();

	const words = $derived(row.tags ? row.tags.split(' ').filter(Boolean) : []);
	const shown = $derived(words.slice(0, 2));
	const overflow = $derived(words.length - shown.length);
</script>

<td class="mgr-tags-cell">
	{#if words.length === 0}
		<span class="mgr-tag-none">—</span>
	{:else}
		{#each shown as w (w)}<span class="mgr-tag-chip">{w}</span>{/each}
		{#if overflow > 0}<span class="mgr-tag-more" title={words.join(' ')}>+{overflow}</span>{/if}
	{/if}
</td>

<style>
	.mgr-tags-cell {
	    width: 10rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mgr-tag-chip {
		display: inline-block;
		margin-right: 0.25rem;
		padding: 0 0.375rem;
		border-radius: 0.625rem;
		background: rgba(139, 92, 246, 0.12);
		color: var(--color-text-secondary, #495057);
		font-size: 0.6875rem;
		line-height: 1.25rem;
		max-width: 6rem;
		overflow: hidden;
		text-overflow: ellipsis;
		vertical-align: middle;
	}
	.mgr-tag-more {
		color: var(--color-text-muted, #888);
		font-size: 0.6875rem;
		font-weight: 600;
		cursor: help;
	}
	.mgr-tag-none {
		color: var(--color-text-muted, #adb5bd);
	}
</style>
