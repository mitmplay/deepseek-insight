<script lang="ts">
	/**
	 * WorkspaceFileTabGroup — the File Eye toggle (ADR D6), extracted
	 * from WorkspaceFileToolbar's .seg-group: the chat-mode-toggle
	 * segmented grammar — joined pill, class:on, aria-pressed. Edit is
	 * default. Presentational: the parent owns the view state and the
	 * change intent; this renders the two segments and reports picks.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		/** The File Eye view — the panel's derived authority (ADR D6). */
		view = 'edit',
		/** A dirty buffer locks the Diff segment (ADR D3). */
		diffDisabled = false,
		/** View intent — the parent bridges it to the owner. */
		onviewchange
	}: {
		view?: 'edit' | 'diff';
		diffDisabled?: boolean;
		onviewchange?: (view: 'edit' | 'diff') => void;
	} = $props();
</script>

<!-- The File Eye toggle (ADR D6): the chat-mode-toggle segmented
     grammar — joined pill, class:on, aria-pressed. Edit is default. -->
<div class="seg-group" role="group" aria-label={t(m.fileEyeToggleLabel)} data-testid="file-view-toggle">
	<button
		type="button"
		class="seg left"
		class:on={view === 'edit'}
		aria-pressed={view === 'edit'}
		data-testid="file-view-edit"
		onclick={() => onviewchange?.('edit')}
	>{t(m.fileEyeEdit)}</button>
	<button
		type="button"
		class="seg right"
		class:on={view === 'diff'}
		disabled={diffDisabled}
		aria-pressed={view === 'diff'}
		data-testid="file-view-diff"
		onclick={() => onviewchange?.('diff')}
	>{t(m.fileEyeDiff)}</button>
</div>

<style>
	/* The File Eye toggle: the chat-mode-toggle segmented grammar. */
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
	.seg-group .seg:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
