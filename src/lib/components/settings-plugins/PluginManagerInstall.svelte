<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	/**
	 * PluginManagerInstall — the rack's install bar (extracted from
	 * PluginManagerPanel): the floor-pinned verb, disabled when nothing
	 * is selected or the DSH restart chain owns the floor (floorBounce);
	 * the label carries the selection count.
	 */
	let {
		/** Number of selected plugins — shown in the label; 0 disables. */
		count,
		/** Disables the verb while the floor is down (DSH restart chain). */
		floorBounce = false,
		/** Install intent — the panel runs the batch. */
		oninstall
	}: {
		count: number;
		floorBounce?: boolean;
		oninstall?: () => void;
	} = $props();
</script>

<div class="rack-install-bar">
	<button type="button" class="rack-install" data-testid="rack-install" onclick={() => oninstall?.()} disabled={count === 0 || floorBounce}>
		{t(m.pluginRackInstall)} ({count})
	</button>
</div>

<style>
	.rack-install-bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 0.5rem;
		background: var(--color-surface, #f8f9fa);
		border-top: 1px solid var(--color-surface-border, #dee2e6);
	}
	.rack-install {
		width: 100%;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		border-radius: 0.375rem;
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 15%, #fff);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		padding: 0.375rem 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.rack-install:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
</style>
