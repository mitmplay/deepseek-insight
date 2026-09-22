<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * SettingsSkillsContainer — the scroll box UNDER the shelf's chrome
	 * (The Shelf Chrome ADR, D1): the toolbar and header sit above in
	 * normal flow; this box takes the rest of the panel column and owns
	 * the overflow, so the body scrolls beneath a stationary chrome.
	 * Mirrors PromptManagerContainer.
	 */
	let { children }: { children: Snippet } = $props();
</script>

<div class="shelf-container" data-testid="shelf-container">
	{@render children()}
</div>

<style>
	.shelf-container {
		flex: 1; /* all the height the chrome above leaves */
		min-height: 0;
		overflow-y: auto;
		padding: 0.25rem 0.5rem;
	}
</style>
