<script lang="ts">
	/**
	 * PluginManagerHeader - the rack chrome's header row (The Plugin Rack
	 * ADR, 2026-09-27, D1), the shelf Header's grammar: the tab group on
	 * the left, the action cluster on the right.
	 * Presentational: every verb and all state are owned by
	 * PluginManagerPanel.
	 */
	import PluginManagerHeaderTabs from './PluginManagerHeaderTabs.svelte';
	import PluginManagerHeaderActions from './PluginManagerHeaderActions.svelte';

	interface Props {
		tab: 'install' | 'uninstall';
		ontabchange: (tab: Props['tab']) => void;
		loading: boolean;
		floorBounce: boolean;
		onreload: () => void;
	}
	let { tab, ontabchange, loading, floorBounce, onreload }: Props = $props();
</script>

<div class="rack-head" data-testid="rack-header">
	<PluginManagerHeaderTabs {tab} ontabchange={ontabchange} />
	<PluginManagerHeaderActions {loading} {floorBounce} {onreload} />
</div>

<style>
	.rack-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
	}
</style>
