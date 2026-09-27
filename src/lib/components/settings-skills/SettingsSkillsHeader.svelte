<script lang="ts">
	/**
	 * SettingsSkillsHeader - the shelf chrome's header row (The Shelf
	 * Chrome ADR): tab group on the left, action cluster on the right —
	 * the reload verb + progress/cancel (install tab only) and the
	 * lineage-fold pill (cross-tab by contract, ADR D2). Presentational:
	 * every verb and all state are owned by SettingsSkillsPanel.
	 */
	import SettingsSkillsHeaderTabs from './SettingsSkillsHeaderTabs.svelte';
	import SettingsSkillsHeaderActions from './SettingsSkillsHeaderActions.svelte';

	interface Props {
		tab: 'install' | 'uninstall';
		ontabchange: (tab: Props['tab']) => void;
		reloadState: 'idle' | 'loading' | 'done';
		busy: boolean;
		progress: {
			done: number;
			total: number;
			skillDone: number;
			skillTotal: number;
			sources: Array<{ name: string; state: 'pending' | 'working' | 'done' }>;
		} | null;
		onreload: () => void;
		oncancelreload: () => void;
		oncollapseall: () => void;
		onexpandall: () => void;
	}
	let { tab, ontabchange, reloadState, busy, progress, onreload, oncancelreload, oncollapseall, onexpandall }: Props = $props();
</script>

<div class="shelf-header" data-testid="shelf-header">
	<SettingsSkillsHeaderTabs {tab} ontabchange={ontabchange} />
	<SettingsSkillsHeaderActions
		{tab}
		{reloadState}
		{busy}
		{progress}
		{onreload}
		{oncancelreload}
		{oncollapseall}
		{onexpandall}
	/>
</div>

<style>
	.shelf-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
	}
</style>
