<script lang="ts">
	import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

	/**
	 * PromptManagerTDTags — the tags body cell (The Prompt Tags ADR,
	 * 2026-09-14, D4; the TDUses/TDLabel cell seam). ALL tag chips render
	 * and wrap down (2026-09-19) — pre mode's tall rows give the column
	 * vertical room. Untagged ('') renders the em-dash, same as the
	 * macro column.
	 */
	let { row }: { row: SuggestedPrompt } = $props();

	const words = $derived(row.tags ? row.tags.split(' ').filter(Boolean) : []);
</script>

<td class="mgr-tags-cell">
	{#if words.length === 0}
		<span class="mgr-tag-none">—</span>
	{:else}
		{#each words as w (w)}<span class="mgr-tag-chip">{w}</span>{/each}
	{/if}
</td>

<style>
	.mgr-tags-cell {
	    width: 10rem;
		/* Wrap-down (2026-09-19): pre mode makes rows tall, so the tags
		   column has vertical room — chips flow onto extra lines instead
		   of one clipped nowrap line. line-height 1.5rem vs the chip's
		   1.25rem is the (half-step) gap BETWEEN wrapped lines. */
		white-space: normal;
		overflow: hidden;
		vertical-align: top;
		/* the wrapped lines' row gap (chips are inline-block) */
		line-height: 1.5rem;
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
	.mgr-tag-none {
		color: var(--color-text-muted, #adb5bd);
	}
</style>
