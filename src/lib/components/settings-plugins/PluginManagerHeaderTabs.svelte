<script lang="ts">
	/**
	 * PluginManagerHeaderTabs - the rack's install/uninstall tab pill
	 * (The Plugin Rack ADR, 2026-09-27, D1), the shelf HeaderTabs'
	 * joined-pill segmented grammar (SettingsSkillsHeaderTabs, D3):
	 * presentational - tab state lives in PluginManagerPanel, this only
	 * renders the two segments and reports picks.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		tab: 'install' | 'uninstall';
		ontabchange: (tab: Props['tab']) => void;
	}
	let { tab, ontabchange }: Props = $props();
</script>

<!-- The joined-pill grammar (SettingsSkillsHeaderTabs): Install | Uninstall. -->
<div class="seg-group" role="group" aria-label={t(m.pluginRackTitle)} data-testid="rack-tabs">
	<button
		type="button"
		class="seg left"
		class:on={tab === 'install'}
		aria-pressed={tab === 'install'}
		data-testid="rack-tab-install"
		onclick={() => ontabchange('install')}
	>{t(m.pluginRackInstall)}</button>
	<button
		type="button"
		class="seg right"
		class:on={tab === 'uninstall'}
		aria-pressed={tab === 'uninstall'}
		data-testid="rack-tab-uninstall"
		onclick={() => ontabchange('uninstall')}
	>{t(m.pluginRackUninstall)}</button>
</div>

<style>
	/* The segmented grammar: zero gap, outer curves only, selected = accent blue. */
	.seg-group {
		flex-shrink: 0;
		display: inline-flex;
	}
	.seg-group .seg {
		border: 1px solid var(--color-border, #d0d7de);
		background: transparent;
		padding: 0.1rem 0.5rem;
		font-size: 0.6875rem;
		cursor: pointer;
	}
	.seg-group .seg.left {
		border-radius: 0.25rem 0 0 0.25rem;
	}
	.seg-group .seg.right {
		border-radius: 0 0.25rem 0.25rem 0;
		border-left: none;
	}
	.seg-group .seg.on {
		background: var(--color-accent-blue, #3b82f6);
		border-color: var(--color-accent-blue, #3b82f6);
		color: #fff;
	}
</style>
