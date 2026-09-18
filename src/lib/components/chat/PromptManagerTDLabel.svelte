<script lang="ts">
	import { textPreviewOf, type SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

	/** Prompt row whose text cell this component renders. */
	let { row }: { row: SuggestedPrompt } = $props();
</script>

<td class="mgr-text-cell" class:mgr-stacked={!!row.label}>
	{#if row.label}<span class="mgr-label-tag">{row.label}</span>{/if}
	<span class="mgr-line2">
		<span class="mgr-preview">{textPreviewOf(row)}</span>
		{#if row.text.includes('\n')}<span class="mgr-ml">⏎</span>{/if}
	</span>
</td>

<style>
	.mgr-text-cell {
		max-width: 28rem;
	}
	.mgr-text-cell.mgr-stacked .mgr-label-tag {
		display: block;
	}
	.mgr-text-cell.mgr-stacked .mgr-line2 {
		display: block;
	}
	.mgr-label-tag {
		display: inline-block;
		margin-right: 0.375rem;
		padding: 0 0.375rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary, #495057);
	}
	.mgr-preview {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		vertical-align: bottom;
	}
	.mgr-ml {
		color: var(--color-text-muted, #adb5bd);
		font-size: 0.6875rem;
	}
	.mgr-line2 {
		padding: 0 0.375rem;
		margin-bottom: 0.25rem;
	}
</style>
