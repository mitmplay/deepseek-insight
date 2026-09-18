<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * SuggestLine — the "Manage prompts" footer line of the SuggestStrip
	 * (extracted from SuggestStrip.svelte). Renders nothing unless
	 * `onmanage` is provided; the click hands back to the host, which
	 * opens the Prompts Manager (Wave 3).
	 */
	let {
		/** ⚙ row: host opens the Prompts Manager (Wave 3). */
		onmanage
	}: {
		onmanage?: () => void;
	} = $props();
</script>

{#if onmanage}
	<button type="button" class="strip-manage" onclick={onmanage}>{t(m.managePrompts)}</button>
{/if}

<style>
	.strip-manage {
		align-self: flex-start;
		border: none;
		background: transparent;
		color: var(--color-text-muted, #868e96);
		cursor: pointer;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		white-space: nowrap;
	}
	.strip-manage:hover {
		color: var(--color-accent-blue, #3b82f6);
	}
</style>
