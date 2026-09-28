<script lang="ts">
	/**
	 * PluginManagerReloadButton - the rack's reload verb as its own
	 * button, extracted from HeaderActions. Presentational: when it
	 * is disabled and what reload does are owned by PluginManagerPanel.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { RotateCw } from '@lucide/svelte';

	interface Props {
		disabled: boolean;
		onreload: () => void;
	}
	let { disabled, onreload }: Props = $props();
</script>

<button
	class="rack-reload"
	type="button"
	title={t(m.pluginRackReload)}
	aria-label={t(m.pluginRackReload)}
	data-testid="rack-reload"
	onclick={onreload}
	{disabled}
>
	<RotateCw size={14} />
</button>

<style>
	.rack-reload {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem 0.35rem;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: transparent;
		cursor: pointer;
	}
	.rack-reload:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
