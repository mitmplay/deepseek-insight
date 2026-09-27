<script lang="ts">
	/**
	 * PluginManagerHeaderActions - the rack header's action cluster,
	 * the shelf HeaderActions' grammar (SettingsSkillsHeaderActions,
	 * The Shelf Chrome ADR): the reload verb. Presentational: every
	 * verb and all state are owned by PluginManagerPanel.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { RotateCw } from '@lucide/svelte';

	interface Props {
		loading: boolean;
		floorBounce: boolean;
		onreload: () => void;
	}
	let { loading, floorBounce, onreload }: Props = $props();
</script>

<div class="rack-header-actions">
	<button
		class="rack-reload"
		type="button"
		title={t(m.pluginRackReload)}
		aria-label={t(m.pluginRackReload)}
		data-testid="rack-reload"
		onclick={onreload}
		disabled={loading || floorBounce}
	>
		<RotateCw size={14} />
	</button>
</div>

<style>
	.rack-header-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}
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
