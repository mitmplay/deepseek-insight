<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	/**
	 * SettingsSkillsInstall — the shelf's install bar (extracted from
	 * SettingsSkillsPanel): the sticky bottom verb, disabled while a call
	 * is in flight or nothing is selected; the label carries the count.
	 */
	let {
		count,
		busy = false,
		oninstall
	}: {
		count: number;
		busy?: boolean;
		oninstall?: () => void;
	} = $props();
</script>

<div class="shelf-install-bar">
	<button type="button" class="shelf-install" data-testid="shelf-install" onclick={() => oninstall?.()} disabled={busy || count === 0}>
		{t(m.skillsShelfInstall)} ({count})
	</button>
</div>

<style>
	.shelf-install-bar {
		position: sticky;
		bottom: 0;
		padding: 0.5rem;
		background: var(--panel-bg, inherit);
	}
	.shelf-install {
		width: 100%;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		border-radius: 0.375rem;
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 15%, #fff);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.shelf-install:not(:disabled):hover {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 22%, #fff);
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 65%, #1e3a8a);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 55%, #1e3a8a);
	}
	.shelf-install:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
</style>
