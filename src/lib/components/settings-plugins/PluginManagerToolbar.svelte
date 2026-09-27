<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import CanvasCopyButton from '$lib/components/common/buttons/CanvasCopyButton.svelte';

	/**
	 * PluginManagerToolbar — the rack's first chrome row, the shelf
	 * Toolbar's grammar (SettingsSkillsToolbar, The Shelf Chrome ADR D2):
	 * LEFT the snapshot timestamp; RIGHT the search input and the panel
	 * capture. Presentational: the panel owns searchQ ($bindable — the
	 * box owns keystrokes, the panel owns the value); this renders the row.
	 */
	let {
		/** The snapshot's generatedAt — the left label's payload. */
		generatedAt,
		/** Search text — $bindable, the panel owns the value. */
		searchQ = $bindable(''),
		/** The capture target: the rack panel's root element. */
		container
	}: {
		generatedAt: string;
		searchQ?: string;
		container: HTMLElement | null | undefined;
	} = $props();
</script>

<div class="rack-toolbar" data-testid="rack-toolbar">
	<span class="rack-generated-label" data-testid="rack-generated">
		{t(m.skillsShelfGeneratedAt)}: {generatedAt}
	</span>
	<div class="rack-toolbar-actions">
		<input
			class="rack-search"
			type="search"
			placeholder={t(m.pluginRackSearch)}
			aria-label={t(m.pluginRackSearch)}
			bind:value={searchQ}
			data-testid="rack-search"
		/>
		<span class="copy-slot">
			<CanvasCopyButton {container} mode="visible" title={t(m.copyPanelAsImage)} size={12} />
		</span>
	</div>
</div>

<style>
	.rack-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		border-bottom: 1px solid var(--color-surface-border, #dee2e6);
	}
	.rack-generated-label {
		font-size: 0.6875rem;
		color: var(--color-text-muted, #888);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.rack-toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1;
		min-width: 0;
	}
	.rack-search {
		flex: 1;
		min-width: 6rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		background: var(--color-surface, #f8f9fa);
		font-size: 0.6875rem;
		padding: 0.15rem 0.35rem;
	}
	.copy-slot {
		display: inline-flex;
		align-items: center;
	}
</style>
