<script lang="ts">

	/**
	 * PromptManagerToolbar — the sticky header's first row (2026-09-19):
	 * LEFT — the prompts.sqlite FULL path (server-expanded, rides
	 * /api/config prompts.dbPath; unknown → the filename only).
	 */

	let {
		dbPath
	}: {
		/** The expanded prompts.sqlite full path ('' when unknown). */
		dbPath: string;
	} = $props();
</script>

<div class="mgr-toolbar-row">
	<span class="mgr-db-path" title={dbPath}>{dbPath || "prompts.sqlite"}</span>
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
</style>
