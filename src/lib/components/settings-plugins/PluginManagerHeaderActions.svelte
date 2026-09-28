<script lang="ts">
	/**
	 * PluginManagerHeaderActions - the rack header's action cluster,
	 * the shelf HeaderActions' grammar (SettingsSkillsHeaderActions,
	 * The Shelf Chrome ADR): the reload verb. Presentational: every
	 * verb and all state are owned by PluginManagerPanel.
	 */
	import PluginManagerReloadButton from './PluginManagerReloadButton.svelte';

	interface Props {
		loading: boolean;
		floorBounce: boolean;
		onreload: () => void;
	}
	let { loading, floorBounce, onreload }: Props = $props();
</script>

<div class="rack-header-actions">
	<PluginManagerReloadButton disabled={loading || floorBounce} {onreload} />
</div>

<style>
	.rack-header-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}
</style>
