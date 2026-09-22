<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import CanvasCopyButton from '$lib/components/common/buttons/CanvasCopyButton.svelte';

	/**
	 * SettingsSkillsToolbar — the shelf's first chrome row (The Shelf
	 * Chrome ADR, D2): LEFT the snapshot timestamp ("Snapshot taken: …",
	 * the PromptManagerToolbar path-label slot); RIGHT the search input
	 * and the panel capture. The collapse/expand fold pill moved to the
	 * header, after the reload verb (2026-09-21 operator order).
	 *
	 * Presentational: the panel owns searchQ ($bindable — the box owns
	 * keystrokes, the panel owns the value); this renders the row.
	 */
	let {
		/** The snapshot's generatedAt — the left label's payload. */
		generatedAt,
		/** Search text — $bindable, the panel owns the value. */
		searchQ = $bindable(''),
		/** The capture target: the shelf panel's root element. */
		container
	}: {
		generatedAt: string;
		searchQ?: string;
		container: HTMLElement | null | undefined;
	} = $props();
</script>

<div class="shelf-toolbar" data-testid="shelf-toolbar">
	<span class="shelf-generated-label" data-testid="shelf-generated">
		{t(m.skillsShelfGeneratedAt)}: {generatedAt}
	</span>
	<div class="shelf-toolbar-actions">
		<input
			class="shelf-search"
			type="search"
			placeholder={t(m.skillsShelfSearch)}
			aria-label={t(m.skillsShelfSearch)}
			bind:value={searchQ}
			data-testid="shelf-search"
		/>
		<span class="copy-slot">
			<CanvasCopyButton {container} mode="visible" title={t(m.copyPanelAsImage)} size={12} />
		</span>
	</div>
</div>

<style>
	.shelf-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		border-bottom: 1px solid var(--color-surface-border, #dee2e6);
	}
	.shelf-generated-label {
		font-size: 0.6875rem;
		color: var(--color-text-muted, #888);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.shelf-toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1; /* the actions row absorbs the empty space... */
		min-width: 0;
	}
	.shelf-search {
		flex: 1; /* ...and the search box eats it (2026-09-21) */
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
