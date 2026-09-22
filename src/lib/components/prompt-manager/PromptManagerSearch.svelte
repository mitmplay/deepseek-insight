<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import ClearIconButton from '$lib/components/common/buttons/ClearIconButton.svelte';
	/**
	 * PromptManagerSearch — the debounced search input of the prompts
	 * manager toolbar (extracted from PromptManagerPanel.svelte).
	 * Value binds to the host's `searchQ`; each keystroke calls `oninput`
	 * (the host owns the 300ms debounce + refresh).
	 *
	 * A clear disc (ClearIconButton, the native search-cancel look) sits
	 * at the bottom-right INSIDE the textarea whenever the box is
	 * non-empty; one click empties the box and fires `oninput` so the
	 * host's debounced refresh runs (2026-09-19; the button became the
	 * shared ClearIconButton 2026-09-22 so PromptInputText reuses it).
	 */
	let {
		value = $bindable(''),
		oninput
	}: {
		value?: string;
		oninput: () => void;
	} = $props();

	let textarea: HTMLTextAreaElement | undefined = $state();

	function clear() {
		value = '';
		oninput();
		// re-focus lives in ClearIconButton via the target prop
	}
</script>

<div class="mgr-search-wrap">
	<textarea
		bind:this={textarea}
		class="mgr-search"
		rows="2"
		placeholder={t(m.searchPrompts)}
		bind:value
		oninput={oninput}
	></textarea>
	{#if value.length > 0}
		<ClearIconButton onclick={clear} label={t(m.clearSearch)} target={textarea} />
	{/if}
</div>

<style>
	.mgr-search-wrap {
		position: relative;
		flex: 1; /* the textarea's former toolbar space, now via the wrapper */
		min-width: 10rem;
	}
	.mgr-search {
		display: block;
		width: 100%;
		padding: 0.25rem 0.25rem;
		padding-right: 2.25rem; /* clear-button reserve (bottom-right) */
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		line-height: 1.2;
		height: calc(2 * 1.2em + 0.5rem + 2px); /* 2 text lines + padding + border */
		resize: none; /* keep the toolbar row height stable */
		background: var(--color-surface, #f8f9fa);
	}
</style>
