<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * PromptManagerSearch — the debounced search input of the prompts
	 * manager toolbar (extracted from PromptManagerPanel.svelte).
	 * Value binds to the host's `searchQ`; each keystroke calls `oninput`
	 * (the host owns the 300ms debounce + refresh).
	 */
	let {
		value = $bindable(''),
		oninput
	}: {
		value?: string;
		oninput: () => void;
	} = $props();
</script>

<textarea
	class="mgr-search"
	rows="2"
	placeholder={t(m.searchPrompts)}
	bind:value
	oninput={oninput}
></textarea>

<style>
	.mgr-search {
		flex: 1; /* occupy the toolbar's empty space */
		min-width: 10rem;
		padding: 0.25rem 0.25rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		line-height: 1.2;
		height: calc(2 * 1.2em + 0.5rem + 2px); /* 2 text lines + padding + border */
		resize: none; /* keep the toolbar row height stable */
		background: var(--color-surface, #f8f9fa);
	}
</style>
