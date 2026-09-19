<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * PromptManagerContainer — the scroll container UNDER the header
	 * (2026-09-19 rework): the header sits on top in normal flow; this
	 * box takes the rest of the panel column and owns the overflow, so
	 * the body table scrolls beneath a stationary header.
	 */
	let { children }: { children: Snippet } = $props();
</script>

<div class="mgr-container">
	{@render children()}
</div>

<style>
	.mgr-container {
		flex: 1; /* all the height the header leaves */
		min-height: 0; /* allow shrink inside the panel's flex column */
		overflow-y: auto; /* THE scroll owner */
		overflow-x: hidden;
	}
</style>
