<script lang="ts">
	import { textPreviewOf, type SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

	/** Prompt row whose text cell this component renders. */
	let { row, textMode = 'norm' }: { row: SuggestedPrompt; textMode?: 'norm' | 'pre' } = $props();
</script>

<td class="mgr-text-cell mgr-stacked">
	<!-- Line 1: the label, style untouched — but an empty label HIDES
	     the line entirely, so the text becomes the one and only line. -->
	{#if row.label}<span class="mgr-label-tag">{row.label}</span>{/if}
	<span class="mgr-line2">
		{#if textMode === 'pre'}
			<!-- pre mode (2026-09-19): the raw text keeps its newlines and
			     indents; past 5 lines the block scrolls, the row never grows. -->
			<span class="mgr-pre">{row.text}</span>
		{:else}
			<span class="mgr-preview">{textPreviewOf(row)}</span>
			{#if row.text.includes('\n')}<span class="mgr-ml">⏎</span>{/if}
		{/if}
	</span>
</td>

<style>
	.mgr-text-cell {
		max-width: 28rem;
		/* the cell-wide text size (2026-09-19): label, preview and the
		   ⏎ marker all inherit it. */
		font-size: 0.65rem;
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
		color: var(--color-text-secondary, #495057);
	}
	.mgr-preview {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		vertical-align: bottom;
	}
	.mgr-ml {
		color: var(--color-text-muted, #adb5bd);
	}
	.mgr-line2 {
		padding: 0 0.375rem;
	}
	/* pre mode: 5 visible lines then scroll (5 * 1.4em line-height). */
	.mgr-pre {
		display: block;
		white-space: pre;
		font-family: var(--font-mono, ui-monospace, monospace);
		line-height: 1.4;
		max-height: calc(5 * 1.4em);
		overflow-y: auto;
		overflow-x: hidden;
		overflow-wrap: normal;
	}
</style>
