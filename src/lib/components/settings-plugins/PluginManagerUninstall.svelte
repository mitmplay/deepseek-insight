<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { LoaderCircle } from '@lucide/svelte';

	/**
	 * PluginManagerUninstall — the per-row uninstall verb (extracted from
	 * PluginManagerPanel): rendered only for an installed row; disabled
	 * while any apply is in flight or the DSH restart chain owns the
	 * floor (floorBounce), and shows the busy spinner for its own row.
	 */
	let {
		plugin,
		busyId = null,
		floorBounce = false,
		onremove
	}: {
		plugin: { id: string; installed: boolean };
		busyId?: string | null;
		floorBounce?: boolean;
		onremove: (id: string) => void;
	} = $props();
</script>

<span class="rack-verb">
	{#if plugin.installed}
		<button type="button" data-testid={'rack-uninstall-' + plugin.id} disabled={busyId !== null || floorBounce} onclick={() => onremove(plugin.id)}>
			{#if busyId === plugin.id}
				<span class="rack-busy" data-testid={'rack-busy-' + plugin.id}><span class="spin"><LoaderCircle size={11} aria-hidden="true" /></span>{t(m.pluginRackUninstall)}</span>
			{:else}
				{t(m.pluginRackUninstall)}
			{/if}
		</button>
	{/if}
</span>

<style>
	.rack-verb {
		display: inline-flex;
	}
	.rack-verb button {
		background: none;
		border: 0;
		cursor: pointer;
		color: inherit;
		font-size: 0.78rem;
		padding: 0.1rem 0.3rem;
	}
	.rack-verb button:disabled {
		opacity: 0.5;
	}
	.rack-busy {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}
	.spin {
		display: inline-flex;
		animation: rack-spin 1s linear infinite;
	}
	@keyframes rack-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
