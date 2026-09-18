<script lang="ts">
	import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

	/** Prompt row whose use-count cell this component renders. */
	let { row }: { row: SuggestedPrompt } = $props();
</script>

<td class="mgr-count">{row.use_count}</td>

<style>
	.mgr-count {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
</style>
