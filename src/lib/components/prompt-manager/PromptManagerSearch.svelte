<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * PromptManagerSearch — the debounced search input of the prompts
	 * manager toolbar (extracted from PromptManagerPanel.svelte).
	 * Value binds to the host's `searchQ`; each keystroke calls `oninput`
	 * (the host owns the 300ms debounce + refresh).
	 *
	 * A clear button (`(x)`) sits at the bottom-right INSIDE the textarea
	 * whenever the box is non-empty; one click empties the box and fires
	 * `oninput` so the host's debounced refresh runs (2026-09-19).
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
		textarea?.focus(); // cleared, not dismissed — typing continues
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
		<button
			type="button"
			class="mgr-search-clear"
			aria-label={t(m.clearSearch)}
			title={t(m.clearSearch)}
			onclick={clear}
		>(x)</button
		>
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
	.mgr-search-clear {
		position: absolute;
		right: 0.25rem;
		bottom: 0.25rem;
		border: none;
		background: transparent;
		cursor: pointer;
		font-size: 0.6875rem;
		line-height: 1;
		border-radius: 0.25rem;
		color: var(--color-text-muted, #888);
	}
	.mgr-search-clear:hover {
		background: var(--color-surface-alt, #f1f3f5);
		color: var(--color-text-primary, #333);
	}
</style>
