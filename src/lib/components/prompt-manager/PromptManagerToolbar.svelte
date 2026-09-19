<script lang="ts">
	import CanvasCopyButton from '$lib/components/common/buttons/CanvasCopyButton.svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	/**
	 * PromptManagerToolbar — the sticky header's first row (2026-09-19):
	 * LEFT — the prompts.sqlite FULL path (server-expanded, rides
	 * /api/config prompts.dbPath; unknown → the filename only).
	 * RIGHT — a CanvasCopyButton capturing the whole PromptManagerPanel
	 * (the container prop is the panel's root element).
	 */

	let {
		dbPath,
		container
	}: {
		/** The expanded prompts.sqlite full path ('' when unknown). */
		dbPath: string;
		/** The PromptManagerPanel root element — the capture target. */
		container: HTMLElement | null | undefined;
	} = $props();
</script>

<div class="mgr-toolbar-row">
	<span class="mgr-db-path" title={dbPath}>{dbPath || "prompts.sqlite"}</span>
	<CanvasCopyButton {container} mode="visible" title={t(m.copyPanelAsImage)}
		class="shrink-0 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
	/>
</div>

<style>
	.mgr-toolbar-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem 0;
		border-bottom: 1px solid var(--color-surface-border, #dee2e6);
	}
	.mgr-db-path {
		font-size: var(--text-xs);
		color: var(--color-text-muted, #888);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.mgr-db-path + :global(button) {
		flex-shrink: 0;
	}
</style>
