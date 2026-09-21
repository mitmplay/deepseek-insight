<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	/**
	 * SettingsSkillsTabgroup — the shelf's own tab pill (The Shelf
	 * Chrome, D3): the joined-pill segmented grammar (class:on,
	 * aria-pressed) speaking the shelf's native tab names directly —
	 * install / uninstall, plain labels, no counts. Install is the
	 * default tab. Presentational: the panel owns the tab state; this
	 * renders the two segments and reports picks.
	 */
	let {
		/** The active tab — the panel's state. */
		tab = 'install',
		/** Tab intent — the panel bridges it to its state. */
		ontabchange
	}: {
		tab?: 'install' | 'uninstall';
		ontabchange?: (tab: 'install' | 'uninstall') => void;
	} = $props();
</script>

<!-- The joined-pill grammar (chat-mode-toggle / File Eye lineage),
     now shelf-native: Install | Uninstall. -->
<div class="seg-group" role="group" aria-label={t(m.skillsShelfTitle)} data-testid="shelf-tab-group">
	<button
		type="button"
		class="seg left"
		class:on={tab === 'install'}
		aria-pressed={tab === 'install'}
		data-testid="shelf-tab-install"
		onclick={() => ontabchange?.('install')}
	>{t(m.skillsShelfTabInstall)}</button>
	<button
		type="button"
		class="seg right"
		class:on={tab === 'uninstall'}
		aria-pressed={tab === 'uninstall'}
		data-testid="shelf-tab-uninstall"
		onclick={() => ontabchange?.('uninstall')}
	>{t(m.skillsShelfTabUninstall)}</button>
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
