<script lang="ts">
	/**
	 * SettingsSkillsReloadButton - the shelf's reload-cancel verb as
	 * its own button, extracted from HeaderActions (Reload Rememberer,
	 * 2026-09-23). Presentational: when it shows and what cancel does
	 * are owned by SettingsSkillsPanel.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { X } from '@lucide/svelte';

	interface Props {
		oncancelreload: () => void;
	}
	let { oncancelreload }: Props = $props();
</script>

<button
	type="button"
	class="shelf-reload-cancel"
	data-testid="shelf-reload-cancel"
	title={t(m.skillsShelfReloadCancel)}
	aria-label={t(m.skillsShelfReloadCancel)}
	onclick={oncancelreload}
>
	<X size={13} aria-hidden="true" />
</button>

<style>
	.shelf-reload-cancel {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem 0.35rem;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: transparent;
		cursor: pointer;
		color: inherit;
	}
	.shelf-reload-cancel:hover {
		color: #cf222e;
		border-color: #cf222e;
	}
</style>
